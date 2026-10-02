import { z } from "zod";

/** Console roles stored on app_user.role. Patients have no web role. */
export const APP_ROLES = ["admin", "staff", "doctor", "provider_staff"] as const;

export const appRoleSchema = z.enum(APP_ROLES);

export type AppRole = z.infer<typeof appRoleSchema>;

export const LOGIN_PATH = "/login";

/** Protected route prefixes and the roles allowed under each. */
const ROUTE_ACCESS: ReadonlyArray<{ prefix: string; roles: readonly AppRole[] }> = [
  { prefix: "/admin", roles: ["admin", "staff"] },
  { prefix: "/partner/doctor", roles: ["doctor"] },
  { prefix: "/partner/provider", roles: ["provider_staff"] },
  // Anything else under /partner is closed until a surface claims it.
  { prefix: "/partner", roles: [] },
];

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Roles allowed to open a path, or null when the path is public.
 * An empty array means the path is protected and open to nobody.
 */
export function allowedRolesForPath(pathname: string): readonly AppRole[] | null {
  const match = ROUTE_ACCESS.find((entry) => isUnder(pathname, entry.prefix));
  return match ? match.roles : null;
}

export function canAccessPath(role: AppRole | null, pathname: string): boolean {
  const allowed = allowedRolesForPath(pathname);
  if (allowed === null) return true;
  return role !== null && allowed.includes(role);
}

/** Where an account lands after signing in. */
export function homePathForRole(role: AppRole | null): string {
  switch (role) {
    case "admin":
    case "staff":
      return "/admin";
    case "doctor":
      return "/partner/doctor";
    case "provider_staff":
      return "/partner/provider";
    default:
      return "/";
  }
}
