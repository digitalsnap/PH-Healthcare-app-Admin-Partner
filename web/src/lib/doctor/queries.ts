import type { SupabaseClient } from "@supabase/supabase-js";
import type { AffiliationRow, ScheduleRow, SlotRow } from "./types";

export const SLOT_COLUMNS = "id, schedule_id, starts_at, ends_at, capacity, remaining, mode";

/** The doctor's slots in [from, to), earliest first. Row-level security scopes them. */
export async function slotsBetween(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  limit: number,
): Promise<SlotRow[]> {
  const { data } = await supabase
    .from("slot")
    .select(SLOT_COLUMNS)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at")
    .order("id")
    .limit(limit);
  return (data ?? []) as SlotRow[];
}

/** Clinic name for each of the doctor's schedules. */
export async function clinicNamesBySchedule(
  supabase: SupabaseClient,
  practitionerId: string,
): Promise<Map<string, string>> {
  const [schedules, affiliations] = await Promise.all([
    supabase.from("schedule").select("id, facility_id, timezone, is_published").eq("practitioner_id", practitionerId),
    supabase
      .from("practitioner_facility")
      .select("id, facility_id, status, facility(name)")
      .eq("practitioner_id", practitionerId),
  ]);
  const names = new Map(
    ((affiliations.data ?? []) as unknown as AffiliationRow[]).map((row) => [row.facility_id, row.facility?.name ?? ""]),
  );
  return new Map(
    ((schedules.data ?? []) as ScheduleRow[]).map((schedule) => [
      schedule.id,
      (schedule.facility_id && names.get(schedule.facility_id)) || "",
    ]),
  );
}
