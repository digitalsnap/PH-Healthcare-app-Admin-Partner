/**
 * Slot generation and booking — types only for now.
 *
 * Slots are generated server-side from availability rules and exceptions.
 * Booking goes through the `book_slot` database function, which locks the
 * slot and relies on the unique (slot_id, seat_no) index. No client computes
 * or posts slots.
 */

/** Instants are stored in UTC and rendered in this zone. */
export const DISPLAY_TIME_ZONE = "Asia/Manila";

export const APPOINTMENT_CHANNELS = ["app", "web", "assisted_counter", "sms", "bot"] as const;
export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

export const APPOINTMENT_MODES = ["in_person", "teleconsult"] as const;
export type AppointmentMode = (typeof APPOINTMENT_MODES)[number];

export const APPOINTMENT_STATUSES = [
  "booked",
  "checked_in",
  "seen",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const SCHEDULE_EXCEPTION_TYPES = ["blackout", "holiday", "leave", "extra_session"] as const;
export type ScheduleExceptionType = (typeof SCHEDULE_EXCEPTION_TYPES)[number];

/** A recurring session. Times are wall-clock in the schedule's timezone. */
export type AvailabilityRule = {
  id: string;
  scheduleId: string;
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekday: number | null;
  recurrence: string | null;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  mode: AppointmentMode;
  validFrom: string;
  validTo: string | null;
};

export type ScheduleException = {
  id: string;
  scheduleId: string;
  type: ScheduleExceptionType;
  /** UTC ISO 8601 instants. */
  startsAt: string;
  endsAt: string;
};

export type Slot = {
  id: string;
  scheduleId: string;
  /** UTC ISO 8601 instants. */
  startsAt: string;
  endsAt: string;
  capacity: number;
  remaining: number;
  mode: AppointmentMode;
};

/** SQLSTATE codes raised by the booking rules in the database. */
export const BOOKING_ERROR_CODES = {
  slotFull: "PH001",
  practitionerNotPrcVerified: "PH002",
  slotMismatch: "PH003",
  slotNotFound: "PH005",
} as const;
