/**
 * Appointment operations shared by the doctor dashboard and the provider
 * portals. Each takes the caller's own RLS-scoped client: whether the caller
 * may touch an appointment is decided by row-level security, not here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAccess } from "@/lib/admin/audit";
import { failed, SAVED, type FormError, type FormState } from "@/lib/admin/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { BOOKING_ERROR_CODES, type AppointmentStatus } from "./index";
import {
  canCancel,
  canMarkNoShow,
  canReschedule,
  canTransition,
  type CancelReason,
} from "./transitions";

/** Database error codes from the booking rules, as form errors. */
export function bookingError(code: string | undefined): FormError {
  switch (code) {
    case BOOKING_ERROR_CODES.slotFull:
      return "slotFull";
    case BOOKING_ERROR_CODES.slotNotFound:
    case BOOKING_ERROR_CODES.slotMismatch:
      return "slotUnavailable";
    case BOOKING_ERROR_CODES.practitionerNotPrcVerified:
      return "prcNotVerified";
    case "PH009":
    case "PH011":
      return "transitionNotAllowed";
    case "PH010":
      return "noShowTooEarly";
    case "PH012":
      return "rescheduleNotAllowed";
    case "PH013":
      return "patientRequired";
    case "PH016":
      return "homeAddressRequired";
    default:
      return "generic";
  }
}

type VisibleAppointment = { id: string; status: AppointmentStatus; patient_id: string; starts_at: string };

/** The appointment, if row-level security lets the caller see it. */
async function visibleAppointment(supabase: SupabaseClient, id: string): Promise<VisibleAppointment | null> {
  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select("id, status, patient_id, starts_at")
    .eq("id", id)
    .maybeSingle();
  return data as VisibleAppointment | null;
}

export type AssistedBooking = {
  slot_id: string;
  service_id: string;
  patient_id: string | null;
  full_name: string | null;
  phone: string | null;
  home_service?: boolean;
  home_address?: string | null;
  home_barangay_code?: string | null;
  home_landmark?: string | null;
};

/**
 * Books for a walk-in or a phone call. The slot must be one the caller can
 * see (their own schedule, or their facility's); a returning patient must be
 * one they already serve. The booking itself goes through book_walk_in(),
 * which records the counter consent and takes the seat under a lock.
 */
export async function bookAssisted(
  supabase: SupabaseClient,
  actorId: string,
  input: AssistedBooking,
): Promise<{ ok: true; appointmentId: string } | { ok: false; state: FormState }> {
  const { data: slot } = await supabase.from("slot").select("id").eq("id", input.slot_id).maybeSingle();
  if (!slot) return { ok: false, state: failed("slotUnavailable") };

  if (input.patient_id) {
    const { data: patient } = await supabase
      .from("patient_profile")
      .select("id")
      .eq("id", input.patient_id)
      .maybeSingle();
    if (!patient) return { ok: false, state: failed("patientRequired") };
  }

  const { data, error } = await createAdminClient().rpc("book_walk_in", {
    p_slot_id: input.slot_id,
    p_actor_id: actorId,
    p_service_id: input.service_id,
    p_patient_id: input.patient_id,
    p_full_name: input.full_name,
    p_phone: input.phone,
    p_home_service: input.home_service ?? false,
    p_home_address: input.home_address ?? null,
    p_home_barangay_code: input.home_barangay_code ?? null,
    p_home_landmark: input.home_landmark ?? null,
  });
  if (error || !data) return { ok: false, state: failed(bookingError(error?.code)) };
  return { ok: true, appointmentId: (data as { id: string }).id };
}

/** Cancelling is its own flow: a reason is recorded and the patient is notified. */
export async function cancelAppointment(
  supabase: SupabaseClient,
  actorId: string,
  id: string,
  reason: CancelReason,
): Promise<FormState> {
  const appointment = await visibleAppointment(supabase, id);
  if (!appointment) return failed("generic");
  if (!canCancel(appointment.status)) return failed("transitionNotAllowed");

  const { error } = await supabase
    .from("appointment")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: "appointment.cancel",
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  return SAVED;
}

/**
 * Reschedule: one UPDATE moves the same appointment, keeping its history. The
 * database takes the new seat under a lock and frees the old one.
 */
export async function moveAppointment(
  supabase: SupabaseClient,
  actorId: string,
  id: string,
  slotId: string,
): Promise<FormState> {
  const appointment = await visibleAppointment(supabase, id);
  if (!appointment) return failed("generic");
  const { data: slot } = await supabase.from("slot").select("id, starts_at").eq("id", slotId).maybeSingle();
  if (!slot) return failed("slotUnavailable");
  if (!canReschedule(appointment.status, slot.starts_at as string, new Date())) {
    return failed("rescheduleNotAllowed");
  }

  const { error } = await supabase.from("appointment").update({ slot_id: slotId }).eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: "appointment.reschedule",
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  return SAVED;
}

/** Check-in, seen, completed and no-show. */
export async function changeAppointmentStatus(
  supabase: SupabaseClient,
  actorId: string,
  id: string,
  status: "checked_in" | "seen" | "completed" | "no_show",
): Promise<FormState> {
  const appointment = await visibleAppointment(supabase, id);
  if (!appointment) return failed("generic");
  if (!canTransition(appointment.status, status)) return failed("transitionNotAllowed");
  if (status === "no_show" && !canMarkNoShow(appointment.status, appointment.starts_at, new Date())) {
    return failed("noShowTooEarly");
  }

  const { error } = await supabase.from("appointment").update({ status }).eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: `appointment.${status}`,
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  return SAVED;
}
