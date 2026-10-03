/**
 * Input validation for the provider portals. Each Zod message is a FormError
 * code (an i18n key), as elsewhere.
 */

import { z } from "zod";
import {
  err,
  fail,
  fields,
  isoDate,
  parseHours,
  parseWith,
  SERVICE_TYPES,
  uuid,
  type FacilityHours,
  type Parsed,
} from "@/lib/admin/schemas";
import { parsePesos, type Centavos } from "@/lib/money";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const name = z.string(err("nameRequired")).min(1, err("nameRequired")).max(200, err("nameRequired"));
const phone = z.string().regex(/^[0-9+() -]{7,20}$/, err("invalidPhone"));

// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX. Stored as +63.
const phMobile = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+639|09)[0-9]{9}$/, err("invalidPhone")))
  .transform((value) => (value.startsWith("09") ? `+63${value.slice(1)}` : value));

// ---------------------------------------------------------------------------
// Facility profile: only what staff may keep current themselves.
// ---------------------------------------------------------------------------

export type ProfileInput = { phone: string | null; address_line: string | null; hours: FacilityHours };

export function parseProfileForm(formData: FormData): Parsed<ProfileInput> {
  const base = parseWith(
    z.object({ phone: phone.optional(), address_line: z.string().max(300, err("generic")).optional() }),
    fields(formData, ["phone", "address_line"]),
  );
  if (!base.ok) return base;
  const hours = parseHours(formData);
  if (!hours.ok) return hours;
  return {
    ok: true,
    data: { phone: base.data.phone ?? null, address_line: base.data.address_line ?? null, hours: hours.data },
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function parseCatalogueServiceForm(formData: FormData) {
  return parseWith(
    z.object({ service_type: z.enum(SERVICE_TYPES, err("invalidChoice")), name }),
    fields(formData, ["service_type", "name"]),
  );
}

export type ProviderPriceInput = {
  service_id: string;
  amount_min_centavos: Centavos;
  amount_max_centavos: Centavos;
};

/**
 * A price the facility enters itself. The source is always facility_confirmed
 * and the observed date is now — set by the server, never taken from the form.
 */
export function parseProviderPriceForm(formData: FormData): Parsed<ProviderPriceInput> {
  const base = parseWith(
    z.object({
      service_id: uuid,
      amount_min: z.string(err("invalidAmount")),
      amount_max: z.string(err("invalidAmount")),
    }),
    fields(formData, ["service_id", "amount_min", "amount_max"]),
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
  return {
    ok: true,
    data: { service_id: base.data.service_id, amount_min_centavos: min, amount_max_centavos: max },
  };
}

export function parsePrepForm(formData: FormData) {
  return parseWith(
    z.object({
      service_id: uuid,
      locale: z.enum(["en", "fil"], err("invalidChoice")),
      instructions: z.string(err("required")).min(1, err("required")).max(1000, err("required")),
      fasting_hours: z.coerce.number(err("required")).int().min(0, err("required")).max(72, err("required")).optional(),
    }),
    fields(formData, ["service_id", "locale", "instructions", "fasting_hours"]),
  );
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export function parseResourceForm(formData: FormData) {
  return parseWith(
    z.object({
      facility_resource: z
        .string(err("resourceNameRequired"))
        .min(1, err("resourceNameRequired"))
        .max(100, err("resourceNameRequired")),
    }),
    fields(formData, ["facility_resource"]),
  );
}

// ---------------------------------------------------------------------------
// Pharmacy
// ---------------------------------------------------------------------------

export function parseStockForm(formData: FormData) {
  return parseWith(
    z.object({
      service_id: uuid,
      available: z.enum(["true", "false"], err("invalidChoice")).transform((value) => value === "true"),
    }),
    fields(formData, ["service_id", "available"]),
  );
}

const counterPatient = {
  patient_id: uuid.optional(),
  full_name: z.string().max(200, err("nameRequired")).optional(),
  phone: phMobile.optional(),
};

type CounterPatient = { patient_id: string | null; full_name: string | null; phone: string | null };

function counterPatientOf(data: {
  patient_id?: string;
  full_name?: string;
  phone?: string;
}): CounterPatient | null {
  if (data.patient_id === undefined && data.full_name === undefined) return null;
  return {
    patient_id: data.patient_id ?? null,
    full_name: data.patient_id ? null : (data.full_name ?? null),
    phone: data.patient_id ? null : (data.phone ?? null),
  };
}

export const RESERVATION_HOLD_DAYS = [1, 2, 3, 7] as const;

export type ReservationInput = CounterPatient & {
  service_id: string;
  quantity: number;
  /** UTC instant: the end of the last hold day in Manila. */
  hold_until: string;
};

export function parseReservationForm(formData: FormData, today: string = manilaToday()): Parsed<ReservationInput> {
  // Consent is given at the counter; no consent, no reservation.
  if (formData.get("consent") !== "on") return fail("consentRequired");
  const parsed = parseWith(
    z.object({
      service_id: uuid,
      quantity: z.coerce.number(err("invalidQuantity")).int(err("invalidQuantity")).min(1, err("invalidQuantity")).max(1000, err("invalidQuantity")),
      hold_days: z.coerce.number(err("invalidChoice")).int().min(1, err("invalidChoice")).max(7, err("invalidChoice")),
      ...counterPatient,
    }),
    fields(formData, ["service_id", "quantity", "hold_days", "patient_id", "full_name", "phone"]),
  );
  if (!parsed.ok) return parsed;
  const patient = counterPatientOf(parsed.data);
  if (!patient) return fail("patientRequired");
  return {
    ok: true,
    data: {
      ...patient,
      service_id: parsed.data.service_id,
      quantity: parsed.data.quantity,
      hold_until: manilaDateToUtcIso(addDays(today, parsed.data.hold_days + 1)),
    },
  };
}

export type RefillInput = CounterPatient & { service_id: string; needed_by: string | null };

export function parseRefillForm(formData: FormData, today: string = manilaToday()): Parsed<RefillInput> {
  if (formData.get("consent") !== "on") return fail("consentRequired");
  const parsed = parseWith(
    z.object({ service_id: uuid, needed_by: isoDate.optional(), ...counterPatient }),
    fields(formData, ["service_id", "needed_by", "patient_id", "full_name", "phone"]),
  );
  if (!parsed.ok) return parsed;
  const patient = counterPatientOf(parsed.data);
  if (!patient) return fail("patientRequired");
  if (parsed.data.needed_by !== undefined && parsed.data.needed_by < today) return fail("invalidDate");
  return {
    ok: true,
    data: { ...patient, service_id: parsed.data.service_id, needed_by: parsed.data.needed_by ?? null },
  };
}

export const RESERVATION_STATUSES = ["reserved", "ready", "picked_up", "cancelled", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const REFILL_STATUSES = ["requested", "accepted", "ready", "picked_up", "declined", "cancelled"] as const;
export type RefillStatus = (typeof REFILL_STATUSES)[number];

/** What staff can do next from each state; the database enforces the same. */
export const RESERVATION_NEXT: Record<ReservationStatus, readonly ReservationStatus[]> = {
  reserved: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: [],
  cancelled: [],
  expired: [],
};

export const REFILL_NEXT: Record<RefillStatus, readonly RefillStatus[]> = {
  requested: ["accepted", "declined"],
  accepted: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: [],
  declined: [],
  cancelled: [],
};

export function parseReservationStatusForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, status: z.enum(RESERVATION_STATUSES, err("transitionNotAllowed")) }),
    fields(formData, ["id", "status"]),
  );
}

export function parseRefillStatusForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, status: z.enum(REFILL_STATUSES, err("transitionNotAllowed")) }),
    fields(formData, ["id", "status"]),
  );
}

// ---------------------------------------------------------------------------
// Result delivery
// ---------------------------------------------------------------------------

/** The private storage bucket behind the health vault. */
export const VAULT_BUCKET = "vault";

export const RESULT_TYPES = ["lab_result", "imaging_result"] as const;
export const RESULT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type ResultMimeType = (typeof RESULT_MIME_TYPES)[number];
/** Kept small: uploads happen from a branch counter on mobile data. */
export const RESULT_MAX_BYTES = 8 * 1024 * 1024;

export type ResultInput = {
  appointment_id: string;
  document_type: (typeof RESULT_TYPES)[number];
  file: File;
  mime_type: ResultMimeType;
};

export function parseResultForm(formData: FormData): Parsed<ResultInput> {
  const parsed = parseWith(
    z.object({ appointment_id: uuid, document_type: z.enum(RESULT_TYPES, err("invalidChoice")) }),
    fields(formData, ["appointment_id", "document_type"]),
  );
  if (!parsed.ok) return parsed;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("fileRequired");
  if (file.size > RESULT_MAX_BYTES) return fail("fileTooLarge");
  const mimeType = RESULT_MIME_TYPES.find((type) => type === file.type);
  if (!mimeType) return fail("fileTypeNotAllowed");

  return { ok: true, data: { ...parsed.data, file, mime_type: mimeType } };
}

export const WITHDRAWAL_REASONS = ["wrong_patient", "wrong_file", "duplicate", "other"] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];
export type WithdrawalStatus = "requested" | "approved" | "rejected";

export function parseWithdrawalForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, withdrawal_reason: z.enum(WITHDRAWAL_REASONS, err("reasonRequired")) }),
    fields(formData, ["id", "withdrawal_reason"]),
  );
}
