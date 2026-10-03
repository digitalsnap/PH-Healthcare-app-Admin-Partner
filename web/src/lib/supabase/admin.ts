import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabasePublicEnv } from "./env";

/**
 * Service-role client. Bypasses row-level security, so it is used only on the
 * server, only for what the signed-in user's own client cannot do (creating
 * auth accounts), and only after the caller's role has been checked.
 */
export function createAdminClient() {
  const serviceRoleKey = z.string().min(1).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient(supabasePublicEnv().url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
