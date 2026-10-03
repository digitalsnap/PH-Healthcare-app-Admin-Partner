import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records that the doctor's screen showed these patients' details: one
 * access_log row per patient per view. Throws if it cannot be written — a
 * page must not show patient data it could not log.
 */
export async function logPatientReads(
  supabase: SupabaseClient,
  actorId: string,
  patientIds: readonly string[],
  action: string,
): Promise<void> {
  const unique = [...new Set(patientIds)];
  if (unique.length === 0) return;
  const { error } = await supabase.from("access_log").insert(
    unique.map((patientId) => ({
      actor_id: actorId,
      subject_patient_id: patientId,
      action,
      resource_type: "appointment",
    })),
  );
  if (error) throw new Error("access_log write failed");
}
