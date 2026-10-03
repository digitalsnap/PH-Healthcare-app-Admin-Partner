"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "@/lib/admin/audit";
import { failed, SAVED, type FormError, type FormState } from "@/lib/admin/form-state";
import { BOOKING_ERROR_CODES, type AppointmentStatus } from "@/lib/scheduling";
import { canCancel, canMarkNoShow, canReschedule, canTransition } from "@/lib/scheduling/transitions";
import { createAdminClient } from "@/lib/supabase/admin";
import { doctorContext, DOCTOR_HOME } from "../context";
import { parseCancelForm, parseRescheduleForm, parseStatusForm, parseWalkInForm } from "../schemas";

type Supabase = Awaited<ReturnType<typeof doctorContext>>["supabase"];

const appointmentPath = (id: string) => `${DOCTOR_HOME}/appointments/${id}`;

function refresh() {
  revalidatePath(DOCTOR_HOME, "layout");
}

/** Database error codes from the booking rules, as form errors. */
function bookingError(code: string | undefined): FormError {
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
    default:
      return "generic";
  }
}

/** The doctor's own appointment, as row-level security lets them see it. */
async function ownAppointment(supabase: Supabase, id: string) {
  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select("id, status, patient_id, starts_at")
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; status: AppointmentStatus; patient_id: string; starts_at: string } | null;
}

/**
 * Manual booking for a walk-in or a phone call. The slot must be on one of
 * the doctor's own schedules (their client can only see those); the booking
 * itself goes through book_walk_in(), which locks the slot.
 */
export async function bookWalkIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseWalkInForm(formData);
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;

  const { data: slot } = await supabase.from("slot").select("id").eq("id", input.slot_id).maybeSingle();
  if (!slot) return failed("slotUnavailable");

  if (input.patient_id) {
    // A returning patient must be one this doctor already has an appointment with.
    const { data: patient } = await supabase
      .from("patient_profile")
      .select("id")
      .eq("id", input.patient_id)
      .maybeSingle();
    if (!patient) return failed("patientRequired");
  }

  const { data, error } = await createAdminClient().rpc("book_walk_in", {
    p_slot_id: input.slot_id,
    p_actor_id: actorId,
    p_service_id: input.service_id,
    p_patient_id: input.patient_id,
    p_full_name: input.full_name,
    p_phone: input.phone,
  });
  if (error || !data) return failed(bookingError(error?.code));

  refresh();
  redirect(appointmentPath((data as { id: string }).id));
}

/** Cancelling is its own flow: a reason is recorded and the patient is notified. */
export async function cancelAppointment(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseCancelForm(formData);
  if (!parsed.ok) return parsed.state;

  const appointment = await ownAppointment(supabase, parsed.data.id);
  if (!appointment) return failed("generic");
  if (!canCancel(appointment.status)) return failed("transitionNotAllowed");

  const { error } = await supabase
    .from("appointment")
    .update({ status: "cancelled", cancel_reason: parsed.data.cancel_reason })
    .eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: "appointment.cancel",
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  refresh();
  return SAVED;
}

async function moveAppointment(appointmentId: string, slotId: string): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();

  const appointment = await ownAppointment(supabase, appointmentId);
  if (!appointment) return failed("generic");
  const { data: slot } = await supabase
    .from("slot")
    .select("id, starts_at")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) return failed("slotUnavailable");
  if (!canReschedule(appointment.status, slot.starts_at as string, new Date())) {
    return failed("rescheduleNotAllowed");
  }

  // One UPDATE: the same appointment moves, keeping its history. The database
  // takes the new seat under a lock and frees the old one.
  const { error } = await supabase.from("appointment").update({ slot_id: slotId }).eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: "appointment.reschedule",
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  refresh();
  return SAVED;
}

export async function rescheduleAppointment(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;
  return moveAppointment(parsed.data.id, parsed.data.slot_id);
}

/** Drag-to-reschedule on the calendar: same rules, same single UPDATE. */
export async function rescheduleByDrag(appointmentId: string, slotId: string): Promise<FormState> {
  const formData = new FormData();
  formData.set("id", appointmentId);
  formData.set("slot_id", slotId);
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;
  return moveAppointment(parsed.data.id, parsed.data.slot_id);
}

/** Check-in, seen, completed and no-show. */
export async function setAppointmentStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const appointment = await ownAppointment(supabase, parsed.data.id);
  if (!appointment) return failed("generic");
  if (!canTransition(appointment.status, parsed.data.status)) return failed("transitionNotAllowed");
  if (
    parsed.data.status === "no_show" &&
    !canMarkNoShow(appointment.status, appointment.starts_at, new Date())
  ) {
    return failed("noShowTooEarly");
  }

  const { error } = await supabase
    .from("appointment")
    .update({ status: parsed.data.status })
    .eq("id", appointment.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: `appointment.${parsed.data.status}`,
    resourceType: "appointment",
    resourceId: appointment.id,
    subjectPatientId: appointment.patient_id,
  });
  refresh();
  return SAVED;
}
