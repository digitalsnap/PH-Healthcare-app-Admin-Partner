import { requireRole } from "@/lib/auth/session";
import type { AppRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const STAFF_ROLES = ["admin", "staff"] as const satisfies readonly AppRole[];

/**
 * The acting account and its RLS-scoped client. Every admin page and action
 * starts here, so the role is checked on every request — not only by the proxy.
 */
export async function adminContext(allowed: readonly AppRole[] = STAFF_ROLES) {
  const session = await requireRole(allowed);
  const supabase = await createClient();
  return { supabase, actorId: session.userId, role: session.role };
}
