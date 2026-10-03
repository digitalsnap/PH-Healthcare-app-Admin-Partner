"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failed, type FormState } from "@/lib/admin/form-state";
import {
  parseCancelForm,
  parseRescheduleForm,
  parseStatusForm,
  parseWalkInForm,
} from "@/lib/doctor/schemas";
import {
  bookAssisted,
  cancelAppointment,
  changeAppointmentStatus,
  moveAppointment,
} from "@/lib/scheduling/operations";
import { facilityContext, facilityPath, PROVIDER_HOME } from "../context";

type Supabase = Awaited<ReturnType<typeof facilityContext>>["supabase"];

/**
 * True when the slot is on one of this facility’s own resource schedules. A
 * doctor’s slots held at the facility are visible to the front desk but are
 * booked and moved from the doctor’s own dashboard.
 */
async function isFacilityResourceSlot(supabase: Supabase, facilityId: string, slotId: string): Promise<boolean> {
  const { data } = await supabase
    .from("slot")
    .select("id, schedule!inner(facility_id, practitioner_id)")
    .eq("id", slotId)
    .eq("schedule.facility_id", facilityId)
    .is("schedule.practitioner_id", null)
    .maybeSingle();
  return data !== null;
}

function refresh() {
  revalidatePath(PROVIDER_HOME, "layout");
}

/**
 * Assisted booking at the counter: the patient's consent is recorded in the
 * access log and the seat is taken under the slot lock, in one transaction.
 */
export async function bookAtCounter(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility, segment } = await facilityContext(
    formData.get("facility_id"),
    "bookings",
  );
  const parsed = parseWalkInForm(formData);
  if (!parsed.ok) return parsed.state;
  if (!(await isFacilityResourceSlot(supabase, facility.id, parsed.data.slot_id))) {
    return failed("slotUnavailable");
  }

  const booked = await bookAssisted(supabase, actorId, {
    ...parsed.data,
    // Home service is a diagnostics offering only.
    home_service: segment === "diagnostics" && parsed.data.home_service,
  });
  if (!booked.ok) return booked.state;

  refresh();
  redirect(facilityPath(facility.id, `bookings/${booked.appointmentId}`));
}

export async function cancelBooking(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await facilityContext(formData.get("facility_id"), "bookings");
  const parsed = parseCancelForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await cancelAppointment(supabase, actorId, parsed.data.id, parsed.data.cancel_reason);
  refresh();
  return result;
}

export async function rescheduleBooking(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "bookings");
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;
  if (!(await isFacilityResourceSlot(supabase, facility.id, parsed.data.slot_id))) {
    return failed("slotUnavailable");
  }

  const result = await moveAppointment(supabase, actorId, parsed.data.id, parsed.data.slot_id);
  refresh();
  return result;
}

/** Drag-to-reschedule on the facility calendar: same checks, same single UPDATE. */
export async function rescheduleBookingByDrag(
  facilityId: string,
  appointmentId: string,
  slotId: string,
): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(facilityId, "calendar");
  const formData = new FormData();
  formData.set("id", appointmentId);
  formData.set("slot_id", slotId);
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;
  if (!(await isFacilityResourceSlot(supabase, facility.id, parsed.data.slot_id))) {
    return failed("slotUnavailable");
  }

  const result = await moveAppointment(supabase, actorId, parsed.data.id, parsed.data.slot_id);
  refresh();
  return result;
}

/** Check-in, seen, completed and no-show: also what drives the clinic queue. */
export async function setBookingStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await facilityContext(formData.get("facility_id"), "bookings");
  const parsed = parseStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await changeAppointmentStatus(supabase, actorId, parsed.data.id, parsed.data.status);
  refresh();
  return result;
}
