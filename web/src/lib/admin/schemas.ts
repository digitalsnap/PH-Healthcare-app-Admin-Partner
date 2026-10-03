/**
 * Input validation for every admin mutation. Each Zod message is a FormError
 * code (an i18n key), so nothing here produces user-facing text directly.
 */

import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";
import { PRICE_SOURCES } from "@/lib/coverage";
import { parsePesos, type Centavos } from "@/lib/money";
import { errorsFromIssues, type FormError, type FormState } from "./form-state";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

export const FACILITY_TYPES = [
  "yakap_clinic",
  "diagnostic_center",
  "pharmacy",
  "hospital_public",
  "hospital_private",
  "rhu",
  "health_center",
  "barangay_health_station",
  "private_clinic",
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified",
  "rejected",
  "suspended",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Statuses a person can set directly; "verified" is only set by recording a verification. */
export const SETTABLE_STATUSES = ["unverified", "pending", "rejected", "suspended"] as const;

export const SERVICE_TYPES = ["consult", "lab_test", "imaging", "procedure", "medicine"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const COVERAGE_PROGRAM_TYPES = [
  "philhealth_yakap",
  "gamot",
  "hmo_plan",
  "senior_discount",
  "pwd_discount",
  "assistance_program",
] as const;
export type CoverageProgramType = (typeof COVERAGE_PROGRAM_TYPES)[number];

export const LICENCE_KINDS = ["doh_lto", "fda_lto", "philhealth_accreditation", "other"] as const;
export const LICENCE_ROWS = 3;

/** ISO weekdays, 1 = Monday ... 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type Parsed<T> = { ok: true; data: T } | { ok: false; state: FormState };

export const err = (code: FormError) => code;

export function fail<T>(...codes: FormError[]): Parsed<T> {
  return { ok: false, state: { errors: codes } };
}

/** Form fields arrive as strings; an empty field means "not provided". */
export function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function fields(formData: FormData, keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, text(formData, key)]));
}

export function parseWith<S extends z.ZodType>(schema: S, input: unknown): Parsed<z.infer<S>> {
  const result = schema.safeParse(input);
  if (!result.success) return { ok: false, state: errorsFromIssues(result.error.issues) };
  return { ok: true, data: result.data };
}

export const uuid = z.uuid(err("invalidChoice"));
export const isoDate = z.iso.date(err("invalidDate"));
const psgcCode = z.string().regex(/^[0-9]{10}$/, err("invalidChoice"));
const httpUrl = z
  .url(err("invalidUrl"))
  .max(500, err("invalidUrl"))
  .regex(/^https?:\/\//, err("invalidUrl"));
const phone = z.string().regex(/^[0-9+() -]{7,20}$/, err("invalidPhone"));
const name = z.string(err("nameRequired")).min(1, err("nameRequired")).max(200, err("nameRequired"));

export const idSchema = uuid;

// ---------------------------------------------------------------------------
// Facility
// ---------------------------------------------------------------------------

// The pilot is in the Philippines; anything outside this box is a typo or a
// swapped latitude/longitude.
const PH_BOUNDS = { latMin: 4, latMax: 22, lngMin: 116, lngMax: 127.5 };

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export type FacilityHours = Record<string, { open: string; close: string }>;
export type LicenceKind = (typeof LICENCE_KINDS)[number];
export type FacilityLicence = { kind: LicenceKind; number: string; expires_on: string | null };

export type FacilityInput = {
  name: string;
  facility_type: FacilityType;
  municipality_code: string;
  barangay_code: string | null;
  parent_org_id: string | null;
  address_line: string | null;
  phone: string | null;
  /** EWKT for the PostGIS point, or null when no coordinates were given. */
  geog: string | null;
  hours: FacilityHours;
  licences: FacilityLicence[];
};

const facilityBase = z.object({
  name,
  facility_type: z.enum(FACILITY_TYPES, err("invalidChoice")),
  municipality_code: psgcCode,
  barangay_code: psgcCode.optional(),
  parent_org_id: uuid.optional(),
  address_line: z.string().max(300, err("generic")).optional(),
  phone: phone.optional(),
});

function parseCoordinates(formData: FormData): Parsed<string | null> {
  const latitude = text(formData, "latitude");
  const longitude = text(formData, "longitude");
  if (latitude === undefined && longitude === undefined) return { ok: true, data: null };
  if (latitude === undefined || longitude === undefined) return fail("coordinatesIncomplete");

  const lat = Number(latitude);
  const lng = Number(longitude);
  const inBounds =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= PH_BOUNDS.latMin &&
    lat <= PH_BOUNDS.latMax &&
    lng >= PH_BOUNDS.lngMin &&
    lng <= PH_BOUNDS.lngMax;
  if (!inBounds) return fail("invalidCoordinates");
  return { ok: true, data: `SRID=4326;POINT(${lng} ${lat})` };
}

export function parseHours(formData: FormData): Parsed<FacilityHours> {
  const hours: FacilityHours = {};
  for (const day of WEEKDAYS) {
    const open = text(formData, `hours_${day}_open`);
    const close = text(formData, `hours_${day}_close`);
    if (open === undefined && close === undefined) continue;
    if (!open || !close || !TIME.test(open) || !TIME.test(close) || close <= open) {
      return fail("invalidHours");
    }
    hours[String(day)] = { open, close };
  }
  return { ok: true, data: hours };
}

function parseLicences(formData: FormData): Parsed<FacilityLicence[]> {
  const licences: FacilityLicence[] = [];
  for (let row = 0; row < LICENCE_ROWS; row += 1) {
    const kind = text(formData, `licence_${row}_kind`);
    const number = text(formData, `licence_${row}_number`);
    const expiresOn = text(formData, `licence_${row}_expires_on`);
    if (kind === undefined && number === undefined && expiresOn === undefined) continue;

    const licenceKind = LICENCE_KINDS.find((option) => option === kind);
    if (!licenceKind || number === undefined || number.length > 100) return fail("licenceIncomplete");
    if (expiresOn !== undefined && !isoDate.safeParse(expiresOn).success) return fail("invalidDate");
    licences.push({ kind: licenceKind, number, expires_on: expiresOn ?? null });
  }
  return { ok: true, data: licences };
}

export function parseFacilityForm(formData: FormData): Parsed<FacilityInput> {
  const base = parseWith(
    facilityBase,
    fields(formData, [
      "name",
      "facility_type",
      "municipality_code",
      "barangay_code",
      "parent_org_id",
      "address_line",
      "phone",
    ]),
  );
  if (!base.ok) return base;
  const geog = parseCoordinates(formData);
  if (!geog.ok) return geog;
  const hours = parseHours(formData);
  if (!hours.ok) return hours;
  const licences = parseLicences(formData);
  if (!licences.ok) return licences;

  return {
    ok: true,
    data: {
      name: base.data.name,
      facility_type: base.data.facility_type,
      municipality_code: base.data.municipality_code,
      barangay_code: base.data.barangay_code ?? null,
      parent_org_id: base.data.parent_org_id ?? null,
      address_line: base.data.address_line ?? null,
      phone: base.data.phone ?? null,
      geog: geog.data,
      hours: hours.data,
      licences: licences.data,
    },
  };
}

export function parseFacilityStatusForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, verification_status: z.enum(SETTABLE_STATUSES, err("invalidChoice")) }),
    fields(formData, ["id", "verification_status"]),
  );
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

export type PriceInput = {
  facility_id: string;
  service_id: string;
  amount_min_centavos: Centavos;
  amount_max_centavos: Centavos;
  source: (typeof PRICE_SOURCES)[number];
  /** UTC instant. */
  observed_at: string;
  report_count: number | null;
};

const priceBase = z.object({
  facility_id: uuid,
  service_id: uuid,
  amount_min: z.string(err("invalidAmount")),
  amount_max: z.string(err("invalidAmount")),
  // A price is never saved without a source and an observed date.
  source: z.enum(PRICE_SOURCES, err("sourceRequired")),
  observed_on: z.string(err("observedAtRequired")).pipe(isoDate),
  report_count: z.coerce.number(err("reportCountRequired")).int().min(1).max(100000).optional(),
});

export function parsePriceForm(formData: FormData, today: string = manilaToday()): Parsed<PriceInput> {
  const base = parseWith(
    priceBase,
    fields(formData, [
      "facility_id",
      "service_id",
      "amount_min",
      "amount_max",
      "source",
      "observed_on",
      "report_count",
    ]),
  );
  if (!base.ok) return base;

  let min: Centavos;
  let max: Centavos;
  try {
    min = parsePesos(base.data.amount_min);
    max = parsePesos(base.data.amount_max);
  } catch {
    return fail("invalidAmount");
  }
  if (max < min) return fail("priceRangeOrder");
  if (base.data.observed_on > today) return fail("observedAtInFuture");

  const patientReported = base.data.source === "patient_reported";
  if (patientReported && base.data.report_count === undefined) return fail("reportCountRequired");

  return {
    ok: true,
    data: {
      facility_id: base.data.facility_id,
      service_id: base.data.service_id,
      amount_min_centavos: min,
      amount_max_centavos: max,
      source: base.data.source,
      observed_at: manilaDateToUtcIso(base.data.observed_on),
      report_count: patientReported ? (base.data.report_count ?? null) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Practitioner
// ---------------------------------------------------------------------------

const specialties = z
  .string()
  .max(500, err("generic"))
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  );

const prcNumber = z
  .string(err("prcNumberRequired"))
  .regex(/^[A-Za-z0-9-]{3,20}$/, err("prcNumberRequired"));

export function parsePractitionerForm(formData: FormData) {
  return parseWith(
    z.object({ full_name: name, specialties, prc_number: prcNumber.optional() }),
    fields(formData, ["full_name", "specialties", "prc_number"]),
  );
}

/**
 * PRC verification needs all of: the PRC number, the licence expiry, and (set
 * by the server, never by the form) who verified and when.
 */
export function parsePrcVerificationForm(formData: FormData, today: string = manilaToday()) {
  const parsed = parseWith(
    z.object({
      id: uuid,
      prc_number: prcNumber,
      prc_licence_expires_on: z.string(err("prcExpiryRequired")).pipe(isoDate),
    }),
    fields(formData, ["id", "prc_number", "prc_licence_expires_on"]),
  );
  if (!parsed.ok) return parsed;
  if (parsed.data.prc_licence_expires_on < today) {
    return fail<typeof parsed.data>("prcExpiryPast");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Service catalogue
// ---------------------------------------------------------------------------

export function parseServiceForm(formData: FormData) {
  return parseWith(
    z.object({
      service_type: z.enum(SERVICE_TYPES, err("invalidChoice")),
      name,
      description: z.string().max(500, err("generic")).optional(),
    }),
    fields(formData, ["service_type", "name", "description"]),
  );
}

// ---------------------------------------------------------------------------
// Coverage programs and accreditations
// ---------------------------------------------------------------------------

export function parseCoverageProgramForm(formData: FormData) {
  return parseWith(
    z.object({
      program_type: z.enum(COVERAGE_PROGRAM_TYPES, err("invalidChoice")),
      code: z.string(err("required")).regex(/^[a-z0-9_]{2,60}$/, err("required")),
      name,
      rules_version: z.string(err("required")).min(1, err("required")).max(60, err("required")),
      // Every program carries a source link.
      source_url: z.string(err("invalidUrl")).pipe(httpUrl),
      last_reviewed_on: isoDate.optional(),
    }),
    fields(formData, [
      "program_type",
      "code",
      "name",
      "rules_version",
      "source_url",
      "last_reviewed_on",
    ]),
  );
}

export function parseAccreditationForm(formData: FormData) {
  const parsed = parseWith(
    z.object({
      facility_id: uuid,
      coverage_program_id: uuid,
      valid_from: z.string(err("invalidDate")).pipe(isoDate),
      valid_to: isoDate.optional(),
      source: z.string(err("sourceRequired")).min(1, err("sourceRequired")).max(200, err("generic")),
      source_url: httpUrl.optional(),
    }),
    fields(formData, [
      "facility_id",
      "coverage_program_id",
      "valid_from",
      "valid_to",
      "source",
      "source_url",
    ]),
  );
  if (!parsed.ok) return parsed;
  if (parsed.data.valid_to !== undefined && parsed.data.valid_to < parsed.data.valid_from) {
    return fail<typeof parsed.data>("datesOrder");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Users and roles
// ---------------------------------------------------------------------------

const role = z.enum(APP_ROLES, err("invalidChoice"));

export function parseInviteForm(formData: FormData) {
  return parseWith(
    z.object({
      email: z.email(err("invalidEmail")).max(254, err("invalidEmail")),
      display_name: name,
      role,
    }),
    fields(formData, ["email", "display_name", "role"]),
  );
}

export function parseAccountForm(formData: FormData) {
  return parseWith(
    z.object({
      id: uuid,
      // No role = an ordinary app account with no console access.
      role: role.optional(),
      is_active: z.enum(["true", "false"], err("invalidChoice")).transform((value) => value === "true"),
    }),
    fields(formData, ["id", "role", "is_active"]),
  );
}
