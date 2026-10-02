import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "./env";

/**
 * Supabase client for server components, server actions and route handlers.
 * It carries the signed-in user's session, so row-level security applies.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot write cookies; the proxy refreshes the
          // session there instead.
        }
      },
    },
  });
}
