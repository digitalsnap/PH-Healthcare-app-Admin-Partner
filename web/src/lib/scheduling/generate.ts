/**
 * Slot generation: availability rules + schedule exceptions -> slots.
 *
 * Pure and deterministic, so the same function gives the doctor a preview and
 * gives the server the rows it writes through sync_schedule_slots(). Nothing
 * here touches a database, and nothing a client sends is ever a slot.
 *
 * Rule times are wall-clock in the schedule's timezone (Asia/Manila only for
 * now: one zone, no DST). Output instants are UTC ISO strings.
 */

import { MANILA_OFFSET, manilaDateToUtcIso, utcIsoToManilaDate } from "@/lib/time/manila";
import type { AppointmentMode } from "./index";

export const SUPPORTED_TIME_ZONE = "Asia/Manila";

export type RuleInput = {
  id: string;
  /** ISO weekday 1 = Monday ... 7 = Sunday. Null means a recurrence string (unsupported). */
  weekday: number | null;
  recurrence: string | null;
  /** "HH:MM" wall-clock in the schedule's timezone. */
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
  /** Minutes kept free before and after each appointment. */
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  mode: AppointmentMode;
  /** Calendar dates in the schedule's timezone, inclusive. */
  validFrom: string;
  validTo: string | null;
};

export type ExceptionInput = {
  id: string;
  type: "blackout" | "holiday" | "leave" | "extra_session";
  /** UTC ISO instants. */
  startsAt: string;
  endsAt: string;
  slotMinutes: number | null;
  capacityPerSlot: number | null;
  mode: AppointmentMode | null;
};

export type GeneratedSlot = {
  /** UTC ISO instants. */
  startsAt: string;
  endsAt: string;
  capacity: number;
  mode: AppointmentMode;
  availabilityRuleId: string | null;
  scheduleExceptionId: string | null;
};

export type GenerateInput = {
  timeZone: string;
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  /** Calendar dates in the schedule's timezone; windowEnd is exclusive. */
  windowStart: string;
  windowEnd: string;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** All calendar dates in [start, end). */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function wallClockToUtcMs(date: string, time: string): number {
  return new Date(`${date}T${time}:00${MANILA_OFFSET}`).getTime();
}

/**
 * Cuts one session into slots. Each appointment is padded by the buffers:
 *   [buffer before][slot][buffer after][buffer before][slot]...
 * A slot is only produced when the whole slot (not its trailing buffer) fits
 * before the session ends.
 */
function sliceSession(
  startMs: number,
  endMs: number,
  slotMinutes: number,
  bufferBefore: number,
  bufferAfter: number,
): Array<[number, number]> {
  const slots: Array<[number, number]> = [];
  let cursor = startMs;
  for (;;) {
    const slotStart = cursor + bufferBefore * MINUTE_MS;
    const slotEnd = slotStart + slotMinutes * MINUTE_MS;
    if (slotEnd > endMs) break;
    slots.push([slotStart, slotEnd]);
    cursor = slotEnd + bufferAfter * MINUTE_MS;
  }
  return slots;
}

function ruleAppliesOn(rule: RuleInput, date: string): boolean {
  if (rule.recurrence !== null || rule.weekday === null) {
    // RRULE recurrences are not generated yet; a rule with one produces nothing.
    return false;
  }
  if (date < rule.validFrom) return false;
  if (rule.validTo !== null && date > rule.validTo) return false;
  return isoWeekday(date) === rule.weekday;
}

/**
 * Generates every slot in the window. Blackouts, holidays and leave remove any
 * slot they overlap, including slots of extra sessions. Where two sources
 * produce a slot at the same instant, the first wins (slots are unique per
 * schedule and start time).
 */
export function generateSlots(input: GenerateInput): GeneratedSlot[] {
  if (input.timeZone !== SUPPORTED_TIME_ZONE) {
    throw new Error(`Unsupported schedule timezone: ${input.timeZone}`);
  }
  const windowStartMs = new Date(manilaDateToUtcIso(input.windowStart)).getTime();
  const windowEndMs = new Date(manilaDateToUtcIso(input.windowEnd)).getTime();
  const candidates: GeneratedSlot[] = [];

  for (const date of datesBetween(input.windowStart, input.windowEnd)) {
    for (const rule of input.rules) {
      if (!ruleAppliesOn(rule, date)) continue;
      const session = sliceSession(
        wallClockToUtcMs(date, rule.startTime),
        wallClockToUtcMs(date, rule.endTime),
        rule.slotMinutes,
        rule.bufferBeforeMinutes,
        rule.bufferAfterMinutes,
      );
      for (const [startMs, endMs] of session) {
        candidates.push({
          startsAt: new Date(startMs).toISOString(),
          endsAt: new Date(endMs).toISOString(),
          capacity: rule.capacityPerSlot,
          mode: rule.mode,
          availabilityRuleId: rule.id,
          scheduleExceptionId: null,
        });
      }
    }
  }

  for (const exception of input.exceptions) {
    if (exception.type !== "extra_session") continue;
    if (!exception.slotMinutes || !exception.capacityPerSlot || !exception.mode) continue;
    const session = sliceSession(
      new Date(exception.startsAt).getTime(),
      new Date(exception.endsAt).getTime(),
      exception.slotMinutes,
      0,
      0,
    );
    for (const [startMs, endMs] of session) {
      candidates.push({
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(endMs).toISOString(),
        capacity: exception.capacityPerSlot,
        mode: exception.mode,
        availabilityRuleId: null,
        scheduleExceptionId: exception.id,
      });
    }
  }

  const blocks = input.exceptions
    .filter((exception) => exception.type !== "extra_session")
    .map((exception) => [new Date(exception.startsAt).getTime(), new Date(exception.endsAt).getTime()]);

  const seen = new Set<string>();
  const slots: GeneratedSlot[] = [];
  for (const slot of candidates) {
    const startMs = new Date(slot.startsAt).getTime();
    const endMs = new Date(slot.endsAt).getTime();
    if (startMs < windowStartMs || startMs >= windowEndMs) continue;
    if (blocks.some(([blockStart, blockEnd]) => startMs < blockEnd && endMs > blockStart)) continue;
    if (seen.has(slot.startsAt)) continue;
    seen.add(slot.startsAt);
    slots.push(slot);
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Slots grouped by their Manila calendar date, for previews and calendars. */
export function groupByManilaDate<T extends { startsAt: string }>(slots: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const slot of slots) {
    const date = utcIsoToManilaDate(slot.startsAt);
    const group = groups.get(date);
    if (group) group.push(slot);
    else groups.set(date, [slot]);
  }
  return groups;
}
