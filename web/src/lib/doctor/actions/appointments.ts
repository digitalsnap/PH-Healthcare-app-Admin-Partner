"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/admin/form-state";
import {
  bookAssisted,
  cancelAppointment as cancelOperation,
  changeAppointmentStatus,
  moveAppointment,
} from "@/lib/scheduling/operations";
import { doctorContext, DOCTOR_HOME } from "../context";
import { parseCancelForm, parseRescheduleForm, parseStatusForm, parseWalkInForm } from "../schemas";

const appointmentPath = (id: string) => `${DOCTOR_HOME}/appointments/${id}`;

function refresh() {
  revalidatePath(DOCTOR_HOME, "layout");
}

/** Manual booking for a walk-in or a phone call, on one of the doctor's own slots. */
export async function bookWalkIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseWalkInForm(formData);
  if (!parsed.ok) return parsed.state;

  const booked = await bookAssisted(supabase, actorId, parsed.data);
  if (!booked.ok) return booked.state;

  refresh();
  redirect(appointmentPath(booked.appointmentId));
}

export async function cancelAppointment(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseCancelForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await cancelOperation(supabase, actorId, parsed.data.id, parsed.data.cancel_reason);
  refresh();
  return result;
}

export async function rescheduleAppointment(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await moveAppointment(supabase, actorId, parsed.data.id, parsed.data.slot_id);
  refresh();
  return result;
}

/** Drag-to-reschedule on the calendar: same rules, same single UPDATE. */
export async function rescheduleByDrag(appointmentId: string, slotId: string): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const formData = new FormData();
  formData.set("id", appointmentId);
  formData.set("slot_id", slotId);
  const parsed = parseRescheduleForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await moveAppointment(supabase, actorId, parsed.data.id, parsed.data.slot_id);
  refresh();
  return result;
}

/** Check-in, seen, completed and no-show. */
export async function setAppointmentStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await doctorContext();
  const parsed = parseStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const result = await changeAppointmentStatus(supabase, actorId, parsed.data.id, parsed.data.status);
  refresh();
  return result;
}
