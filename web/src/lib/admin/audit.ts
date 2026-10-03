import type { SupabaseClient } from "@supabase/supabase-js";

/** What an access_log row may say. Ids only — never names or health details. */
export type AuditEntry = {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  subjectPatientId?: string | null;
};

/**
 * Writes one access_log row under the acting account. Row-level security only
 * accepts a row whose actor is the caller, so this cannot be forged. Throws on
 * failure: a write that cannot be logged must not look like it succeeded.
 */
export async function logAccess(
  supabase: SupabaseClient,
  actorId: string,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await supabase.from("access_log").insert({
    actor_id: actorId,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    subject_patient_id: entry.subjectPatientId ?? null,
  });
  if (error) throw new Error("access_log write failed");
}
