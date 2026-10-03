import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDays,
  generateSlots,
  type ExceptionInput,
  type GeneratedSlot,
  type RuleInput,
} from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";
import type { ExceptionRow, RuleRow, ScheduleRow } from "./types";

/** How far ahead slots are kept generated for a published schedule. */
export const HORIZON_DAYS = 56;

export const RULE_COLUMNS =
  "id, schedule_id, weekday, recurrence, start_time, end_time, slot_minutes, capacity_per_slot, " +
  "buffer_before_minutes, buffer_after_minutes, mode, valid_from, valid_to";

export const EXCEPTION_COLUMNS =
  "id, schedule_id, exception_type, starts_at, ends_at, slot_minutes, capacity_per_slot, mode";

/** Postgres returns "HH:MM:SS"; the generator works in "HH:MM". */
const hhmm = (value: string) => value.slice(0, 5);

export function toRuleInput(row: RuleRow): RuleInput {
  return {
    id: row.id,
    weekday: row.weekday,
    recurrence: row.recurrence,
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    slotMinutes: row.slot_minutes,
    capacityPerSlot: row.capacity_per_slot,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    mode: row.mode,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

export function toExceptionInput(row: ExceptionRow): ExceptionInput {
  return {
    id: row.id,
    type: row.exception_type,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    slotMinutes: row.slot_minutes,
    capacityPerSlot: row.capacity_per_slot,
    mode: row.mode,
  };
}

/**
 * Regenerates a schedule's slots for the horizon and writes them through
 * sync_schedule_slots(). An unpublished schedule generates nothing, so its
 * free slots are withdrawn (booked ones always stay).
 *
 * `supabase` is the doctor's own client: reading the schedule, rules and
 * exceptions through it is what proves the schedule is theirs. Only the final
 * write uses the service role, because no client may write slots.
 */
export async function syncSchedule(supabase: SupabaseClient, scheduleId: string): Promise<boolean> {
  const { data: schedule } = await supabase
    .from("schedule")
    .select("id, facility_id, timezone, is_published")
    .eq("id", scheduleId)
    .maybeSingle();
  if (!schedule) return false;
  const row = schedule as ScheduleRow;

  const windowStart = manilaToday();
  const windowEnd = addDays(windowStart, HORIZON_DAYS);
  const windowStartIso = manilaDateToUtcIso(windowStart);
  const windowEndIso = manilaDateToUtcIso(windowEnd);

  let slots: GeneratedSlot[] = [];
  if (row.is_published) {
    const [rules, exceptions] = await Promise.all([
      supabase.from("availability_rule").select(RULE_COLUMNS).eq("schedule_id", scheduleId),
      supabase
        .from("schedule_exception")
        .select(EXCEPTION_COLUMNS)
        .eq("schedule_id", scheduleId)
        .lt("starts_at", windowEndIso)
        .gt("ends_at", windowStartIso),
    ]);
    slots = generateSlots({
      timeZone: row.timezone,
      rules: ((rules.data ?? []) as unknown as RuleRow[]).map(toRuleInput),
      exceptions: ((exceptions.data ?? []) as unknown as ExceptionRow[]).map(toExceptionInput),
      windowStart,
      windowEnd,
    });
  }

  // Slots already in the past are left alone: the window starts now.
  const now = new Date().toISOString();
  const { error } = await createAdminClient().rpc("sync_schedule_slots", {
    p_schedule_id: scheduleId,
    p_window_start: now,
    p_window_end: windowEndIso,
    p_slots: slots
      .filter((slot) => slot.startsAt >= now)
      .map((slot) => ({
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        capacity: slot.capacity,
        mode: slot.mode,
        availability_rule_id: slot.availabilityRuleId ?? "",
        schedule_exception_id: slot.scheduleExceptionId ?? "",
      })),
  });
  return !error;
}
