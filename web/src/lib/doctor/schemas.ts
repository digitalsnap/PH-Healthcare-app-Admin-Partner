/**
 * Input validation for every doctor-dashboard mutation. As in the admin
 * console, each Zod message is a FormError code (an i18n key).
 */

import { z } from "zod";
import { err, fail, fields, isoDate, parseWith, text, uuid, type Parsed } from "@/lib/admin/schemas";
import { addDays } from "@/lib/scheduling/generate";
import { CANCEL_REASONS } from "@/lib/scheduling/transitions";
import { MANILA_OFFSET, manilaDateToUtcIso } from "@/lib/time/manila";

const time = z.string(err("timesOrder")).regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, err("timesOrder"));
const slotMinutes = z.coerce
  .number(err("invalidSlotLength"))
  .int(err("invalidSlotLength"))
  .min(5, err("invalidSlotLength"))
  .max(720, err("invalidSlotLength"));
const capacity = z.coerce.number(err("required")).int(err("required")).min(1, err("required")).max(500, err("required"));

// ---------------------------------------------------------------------------
// Availability rules
// ---------------------------------------------------------------------------

const RULE_VALUE_FIELDS = [
  "weekday",
  "start_time",
  "end_time",
  "slot_minutes",
  "capacity_per_slot",
  "valid_from",
  "valid_to",
] as const;

/** A doctor's rule names the clinic; a facility's rule names the resource schedule. */
export const RULE_FIELDS = ["facility_id", ...RULE_VALUE_FIELDS] as const;
export const RESOURCE_RULE_FIELDS = ["schedule_id", ...RULE_VALUE_FIELDS] as const;

const ruleValues = {
  weekday: z.coerce.number(err("invalidChoice")).int().min(1, err("invalidChoice")).max(7, err("invalidChoice")),
  start_time: time,
  end_time: time,
  slot_minutes: slotMinutes,
  capacity_per_slot: capacity,
  valid_from: z.string(err("invalidDate")).pipe(isoDate),
  valid_to: isoDate.optional(),
};

const ruleSchema = z.object({ facility_id: uuid, ...ruleValues });
const resourceRuleSchema = z.object({ schedule_id: uuid, ...ruleValues });

export type RuleFormInput = z.infer<typeof ruleSchema>;
export type ResourceRuleFormInput = z.infer<typeof resourceRuleSchema>;

/** The checks a rule must pass beyond each field being well-formed. */
function ruleProblem(
  rule: Omit<RuleFormInput, "facility_id">,
): "timesOrder" | "datesOrder" | "invalidSlotLength" | null {
  if (rule.end_time <= rule.start_time) return "timesOrder";
  if (rule.valid_to !== undefined && rule.valid_to < rule.valid_from) return "datesOrder";

  // The session must hold at least one whole slot.
  const [startHour, startMinute] = rule.start_time.split(":").map(Number);
  const [endHour, endMinute] = rule.end_time.split(":").map(Number);
  const sessionMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (rule.slot_minutes > sessionMinutes) return "invalidSlotLength";
  return null;
}

export function parseRuleForm(formData: FormData): Parsed<RuleFormInput> {
  const parsed = parseWith(ruleSchema, fields(formData, RULE_FIELDS));
  if (!parsed.ok) return parsed;
  const problem = ruleProblem(parsed.data);
  return problem ? fail(problem) : parsed;
}

export function parseResourceRuleForm(formData: FormData): Parsed<ResourceRuleFormInput> {
  const parsed = parseWith(resourceRuleSchema, fields(formData, RESOURCE_RULE_FIELDS));
  if (!parsed.ok) return parsed;
  const problem = ruleProblem(parsed.data);
  return problem ? fail(problem) : parsed;
}

/** The same rule fields arriving as a preview query string. */
export function ruleFormFromQuery(
  query: Record<string, string | string[] | undefined>,
  keys: readonly string[] = RULE_FIELDS,
): FormData {
  const formData = new FormData();
  for (const key of keys) {
    const value = query[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) formData.set(key, first);
  }
  return formData;
}

// ---------------------------------------------------------------------------
// Schedule exceptions
// ---------------------------------------------------------------------------

export const BLOCKING_EXCEPTION_TYPES = ["blackout", "holiday", "leave"] as const;

export type ExceptionFormInput = {
  schedule_id: string;
  exception_type: "blackout" | "holiday" | "leave" | "extra_session";
  /** UTC instants. */
  starts_at: string;
  ends_at: string;
  slot_minutes: number | null;
  capacity_per_slot: number | null;
  mode: "in_person" | null;
};

/**
 * Blackouts, holidays and leave cover whole Manila calendar days (inclusive).
 * An extra session is one day with a start and end time.
 */
export function parseExceptionForm(formData: FormData): Parsed<ExceptionFormInput> {
  const type = text(formData, "exception_type");

  if (type === "extra_session") {
    const parsed = parseWith(
      z.object({
        schedule_id: uuid,
        start_date: z.string(err("invalidDate")).pipe(isoDate),
        start_time: time,
        end_time: time,
        slot_minutes: slotMinutes,
        capacity_per_slot: capacity,
      }),
      fields(formData, ["schedule_id", "start_date", "start_time", "end_time", "slot_minutes", "capacity_per_slot"]),
    );
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    if (data.end_time <= data.start_time) return fail("timesOrder");
    return {
      ok: true,
      data: {
        schedule_id: data.schedule_id,
        exception_type: "extra_session",
        starts_at: new Date(`${data.start_date}T${data.start_time}:00${MANILA_OFFSET}`).toISOString(),
        ends_at: new Date(`${data.start_date}T${data.end_time}:00${MANILA_OFFSET}`).toISOString(),
        slot_minutes: data.slot_minutes,
        capacity_per_slot: data.capacity_per_slot,
        mode: "in_person",
      },
    };
  }

  const parsed = parseWith(
    z.object({
      schedule_id: uuid,
      exception_type: z.enum(BLOCKING_EXCEPTION_TYPES, err("invalidChoice")),
      start_date: z.string(err("invalidDate")).pipe(isoDate),
      end_date: isoDate.optional(),
    }),
    fields(formData, ["schedule_id", "exception_type", "start_date", "end_date"]),
  );
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const endDate = data.end_date ?? data.start_date;
  if (endDate < data.start_date) return fail("datesOrder");
  return {
    ok: true,
    data: {
      schedule_id: data.schedule_id,
      exception_type: data.exception_type,
      starts_at: manilaDateToUtcIso(data.start_date),
      ends_at: manilaDateToUtcIso(addDays(endDate, 1)),
      slot_minutes: null,
      capacity_per_slot: null,
      mode: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function parseProfileForm(formData: FormData) {
  return parseWith(
    z.object({
      specialties: z
        .string()
        .max(500, err("generic"))
        .optional()
        .transform((value) =>
          (value ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== ""),
        ),
    }),
    fields(formData, ["specialties"]),
  );
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX. Stored as +63.
const phMobile = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+639|09)[0-9]{9}$/, err("invalidPhone")))
  .transform((value) => (value.startsWith("09") ? `+63${value.slice(1)}` : value));

export type WalkInInput = {
  slot_id: string;
  service_id: string;
  patient_id: string | null;
  full_name: string | null;
  phone: string | null;
  home_service: boolean;
  home_address: string | null;
  home_barangay_code: string | null;
  home_landmark: string | null;
};

export function parseWalkInForm(formData: FormData): Parsed<WalkInInput> {
  // Consent is given at the counter or on the phone; no consent, no booking.
  if (formData.get("consent") !== "on") return fail("consentRequired");

  const parsed = parseWith(
    z.object({
      slot_id: uuid,
      service_id: uuid,
      patient_id: uuid.optional(),
      full_name: z.string().max(200, err("nameRequired")).optional(),
      phone: phMobile.optional(),
      home_address: z.string().max(300, err("homeAddressRequired")).optional(),
      home_barangay_code: z.string().regex(/^[0-9]{10}$/, err("invalidChoice")).optional(),
      home_landmark: z.string().max(200, err("generic")).optional(),
    }),
    fields(formData, [
      "slot_id",
      "service_id",
      "patient_id",
      "full_name",
      "phone",
      "home_address",
      "home_barangay_code",
      "home_landmark",
    ]),
  );
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  if (data.patient_id === undefined && data.full_name === undefined) return fail("patientRequired");
  // A home-service visit needs somewhere to go.
  const homeService = formData.get("home_service") === "on";
  if (homeService && data.home_address === undefined) return fail("homeAddressRequired");
  return {
    ok: true,
    data: {
      slot_id: data.slot_id,
      service_id: data.service_id,
      patient_id: data.patient_id ?? null,
      // A returning patient's details are not overwritten from this form.
      full_name: data.patient_id ? null : (data.full_name ?? null),
      phone: data.patient_id ? null : (data.phone ?? null),
      home_service: homeService,
      home_address: homeService ? (data.home_address ?? null) : null,
      home_barangay_code: homeService ? (data.home_barangay_code ?? null) : null,
      home_landmark: homeService ? (data.home_landmark ?? null) : null,
    },
  };
}

export function parseCancelForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, cancel_reason: z.enum(CANCEL_REASONS, err("reasonRequired")) }),
    fields(formData, ["id", "cancel_reason"]),
  );
}

export function parseRescheduleForm(formData: FormData) {
  return parseWith(z.object({ id: uuid, slot_id: uuid }), fields(formData, ["id", "slot_id"]));
}

export const SETTABLE_APPOINTMENT_STATUSES = ["checked_in", "seen", "completed", "no_show"] as const;

export function parseStatusForm(formData: FormData) {
  return parseWith(
    z.object({ id: uuid, status: z.enum(SETTABLE_APPOINTMENT_STATUSES, err("transitionNotAllowed")) }),
    fields(formData, ["id", "status"]),
  );
}
