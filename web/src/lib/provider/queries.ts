import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoverageProgramType } from "@/lib/admin/schemas";
import { manilaToday } from "@/lib/time/manila";

export type AccreditationStatus = { yakap: boolean; gamot: boolean };

/** Whether the facility holds a current YAKAP or GAMOT accreditation today. */
export async function accreditationStatus(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<AccreditationStatus> {
  const today = manilaToday();
  const { data } = await supabase
    .from("accreditation")
    .select("valid_from, valid_to, coverage_program(program_type)")
    .eq("facility_id", facilityId)
    .lte("valid_from", today);
  const rows = (data ?? []) as unknown as {
    valid_to: string | null;
    coverage_program: { program_type: CoverageProgramType } | null;
  }[];
  const current = (type: CoverageProgramType) =>
    rows.some(
      (row) => row.coverage_program?.program_type === type && (row.valid_to === null || row.valid_to >= today),
    );
  return { yakap: current("philhealth_yakap"), gamot: current("gamot") };
}

/** The facility's resource schedules, with a display name for each. */
export async function resourceSchedules(supabase: SupabaseClient, facilityId: string) {
  const { data } = await supabase
    .from("schedule")
    .select("id, facility_resource, timezone, is_published")
    .eq("facility_id", facilityId)
    .is("practitioner_id", null)
    .order("created_at");
  return (data ?? []) as { id: string; facility_resource: string; timezone: string; is_published: boolean }[];
}

/** Patients this facility already serves, most recent first, for a "returning" picker. */
export async function knownPatients(
  supabase: SupabaseClient,
  facilityId: string,
  limit: number,
): Promise<Array<[id: string, name: string]>> {
  const [appointments, reservations, refills] = await Promise.all([
    supabase
      .from("appointment")
      .select("patient_id, created_at")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("reservation")
      .select("patient_id, created_at")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("refill_request")
      .select("patient_id, created_at")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  const ids = [
    ...new Set(
      [...(appointments.data ?? []), ...(reservations.data ?? []), ...(refills.data ?? [])].map(
        (row) => (row as { patient_id: string }).patient_id,
      ),
    ),
  ].slice(0, limit);
  if (ids.length === 0) return [];

  const { data } = await supabase.from("patient_profile").select("id, full_name").in("id", ids).order("full_name");
  return ((data ?? []) as { id: string; full_name: string }[]).map((row) => [row.id, row.full_name]);
}
