import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessPath, homePathForRole, LOGIN_PATH } from "@/lib/auth/roles";
import { fetchRole } from "@/lib/auth/fetch-role";
import { supabasePublicEnv } from "@/lib/supabase/env";

/**
 * Enforces the role per route group before anything renders:
 *   /admin/...            admin, staff
 *   /partner/doctor/...   doctor
 *   /partner/provider/... provider_staff
 * Also refreshes the Supabase session cookie. Each group's layout repeats the
 * check with requireRole(), so the proxy is never the only gate.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabasePublicEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Redirects must carry any refreshed session cookies with them.
  const redirectTo = (pathname: string) => {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    target.search = "";
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user) {
    return pathname === LOGIN_PATH ? response : redirectTo(LOGIN_PATH);
  }

  const role = await fetchRole(supabase, user.id);

  if (pathname === LOGIN_PATH) {
    return role === null ? response : redirectTo(homePathForRole(role));
  }
  if (!canAccessPath(role, pathname)) {
    return redirectTo(homePathForRole(role));
  }
  return response;
}

export const config = {
  matcher: ["/login", "/admin/:path*", "/partner/:path*"],
};
