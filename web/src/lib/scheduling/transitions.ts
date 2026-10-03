/**
 * Appointment state rules. The database enforces the same rules in
 * appointment_guard_transition(); this copy lets the server decide what to
 * offer before it tries, and is what the tests pin down.
 */

import type { AppointmentStatus } from "./index";

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ["checked_in", "cancelled", "no_show"],
  checked_in: ["seen", "cancelled", "no_show"],
  seen: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const CANCEL_REASONS = [
  "patient_request",
  "practitioner_unavailable",
  "facility_closed",
  "duplicate",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function canCancel(status: AppointmentStatus): boolean {
  return canTransition(status, "cancelled");
}

/** A no-show can only be marked once the slot has started. */
export function canMarkNoShow(status: AppointmentStatus, slotStartsAt: string, now: Date): boolean {
  return canTransition(status, "no_show") && new Date(slotStartsAt).getTime() <= now.getTime();
}

/** Only a booked appointment moves, and only into a slot still ahead. */
export function canReschedule(status: AppointmentStatus, newSlotStartsAt: string, now: Date): boolean {
  return status === "booked" && new Date(newSlotStartsAt).getTime() > now.getTime();
}

/** The next front-office steps a doctor can take, in the order shown. */
export type VisitStep = "checked_in" | "seen" | "completed";

export function nextSteps(status: AppointmentStatus): VisitStep[] {
  return APPOINTMENT_TRANSITIONS[status].filter(
    (next): next is VisitStep => next === "checked_in" || next === "seen" || next === "completed",
  );
}
