import type { SupabaseClient } from "@supabase/supabase-js";
import { appRoleSchema, type AppRole } from "./roles";

/**
 * Reads the account's role from app_user (row-level security lets an account
 * read its own row). Inactive or unknown accounts have no role.
 */
export async function fetchRole(supabase: SupabaseClient, userId: string): Promise<AppRole | null> {
  const { data } = await supabase
    .from("app_user")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!data?.is_active) return null;
  const parsed = appRoleSchema.safeParse(data.role);
  return parsed.success ? parsed.data : null;
}
