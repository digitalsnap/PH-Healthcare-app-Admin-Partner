import type { AppointmentChannel, AppointmentMode, AppointmentStatus } from "@/lib/scheduling";
import type { CancelReason } from "@/lib/scheduling/transitions";

/** Rows as the doctor dashboard reads them. Timestamps are UTC ISO strings. */

export type DoctorProfile = {
  id: string;
  full_name: string;
  specialties: string[];
  prc_number: string | null;
  prc_licence_expires_on: string | null;
  prc_verified_at: string | null;
  verification_requested_at: string | null;
  is_live: boolean;
};

export type AffiliationStatus = "pending" | "approved" | "rejected";

export type AffiliationRow = {
  id: string;
  facility_id: string;
  status: AffiliationStatus;
  facility: { name: string } | null;
};

export type ScheduleRow = {
  id: string;
  facility_id: string | null;
  timezone: string;
  is_published: boolean;
};

export type RuleRow = {
  id: string;
  schedule_id: string;
  weekday: number | null;
  recurrence: string | null;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity_per_slot: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  mode: AppointmentMode;
  valid_from: string;
  valid_to: string | null;
};

export type ExceptionRow = {
  id: string;
  schedule_id: string;
  exception_type: "blackout" | "holiday" | "leave" | "extra_session";
  starts_at: string;
  ends_at: string;
  slot_minutes: number | null;
  capacity_per_slot: number | null;
  mode: AppointmentMode | null;
};

export type SlotRow = {
  id: string;
  schedule_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  remaining: number;
  mode: AppointmentMode;
};

export type AppointmentRow = {
  id: string;
  booking_code: string | null;
  status: AppointmentStatus;
  mode: AppointmentMode;
  channel: AppointmentChannel;
  cancel_reason: CancelReason | null;
  patient_id: string;
  patient_name: string;
  patient_phone: string | null;
  facility_id: string | null;
  facility_name: string | null;
  service_name: string | null;
  slot_id: string;
  schedule_id: string;
  starts_at: string;
  ends_at: string;
};

export const APPOINTMENT_COLUMNS =
  "id, booking_code, status, mode, channel, cancel_reason, patient_id, patient_name, patient_phone, " +
  "facility_id, facility_name, service_name, slot_id, schedule_id, starts_at, ends_at";
