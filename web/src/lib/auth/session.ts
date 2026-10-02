import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchRole } from "./fetch-role";
import { homePathForRole, LOGIN_PATH, type AppRole } from "./roles";

export type Session = {
  userId: string;
  role: AppRole | null;
};

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { userId: user.id, role: await fetchRole(supabase, user.id) };
}

/**
 * Authoritative role check for a route group's layout. The proxy does the same
 * check earlier; this one guards the render itself.
 */
export async function requireRole(allowed: readonly AppRole[]): Promise<Session & { role: AppRole }> {
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  if (session.role === null || !allowed.includes(session.role)) {
    redirect(homePathForRole(session.role));
  }
  return { userId: session.userId, role: session.role };
}
