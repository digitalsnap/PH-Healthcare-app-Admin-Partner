import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { DoctorProfile } from "./types";

export const DOCTOR_HOME = "/partner/doctor";
export const UNLINKED_PATH = "/partner/doctor/unlinked";

/**
 * The acting doctor: their RLS-scoped client and their own practitioner row.
 * An account with the doctor role but no practitioner profile linked to it
 * (the admin links them) has nothing to manage yet.
 */
export async function doctorContext() {
  const session = await requireRole(["doctor"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("practitioner")
    .select("id, full_name, specialties, prc_number, prc_licence_expires_on, prc_verified_at, verification_requested_at, is_live")
    .eq("app_user_id", session.userId)
    .maybeSingle();
  if (!data) redirect(UNLINKED_PATH);

  return { supabase, actorId: session.userId, practitioner: data as DoctorProfile };
}
