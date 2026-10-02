import { describe, expect, it } from "vitest";
import { allowedRolesForPath, APP_ROLES, canAccessPath, homePathForRole } from "./roles";

describe("allowedRolesForPath", () => {
  it("treats public paths as open", () => {
    expect(allowedRolesForPath("/")).toBeNull();
    expect(allowedRolesForPath("/login")).toBeNull();
    expect(allowedRolesForPath("/administration")).toBeNull();
    expect(allowedRolesForPath("/partners")).toBeNull();
  });

  it("maps each console to its roles", () => {
    expect(allowedRolesForPath("/admin")).toEqual(["admin", "staff"]);
    expect(allowedRolesForPath("/admin/facilities/new")).toEqual(["admin", "staff"]);
    expect(allowedRolesForPath("/partner/doctor/calendar")).toEqual(["doctor"]);
    expect(allowedRolesForPath("/partner/provider")).toEqual(["provider_staff"]);
  });

  it("closes unclaimed /partner paths to everyone", () => {
    expect(allowedRolesForPath("/partner")).toEqual([]);
    expect(allowedRolesForPath("/partner/doctors")).toEqual([]);
  });
});

describe("canAccessPath", () => {
  it("keeps every role inside its own console", () => {
    const consoles = ["/admin", "/partner/doctor", "/partner/provider"];
    const expected: Record<string, string[]> = {
      admin: ["/admin"],
      staff: ["/admin"],
      doctor: ["/partner/doctor"],
      provider_staff: ["/partner/provider"],
    };
    for (const role of APP_ROLES) {
      expect(consoles.filter((path) => canAccessPath(role, path))).toEqual(expected[role]);
    }
  });

  it("gives accounts without a role (patients, signed-out) only public paths", () => {
    expect(canAccessPath(null, "/")).toBe(true);
    expect(canAccessPath(null, "/admin")).toBe(false);
    expect(canAccessPath(null, "/partner/doctor")).toBe(false);
    expect(canAccessPath(null, "/partner/provider")).toBe(false);
  });
});

describe("homePathForRole", () => {
  it("lands each role somewhere it is allowed to be", () => {
    for (const role of APP_ROLES) {
      expect(canAccessPath(role, homePathForRole(role))).toBe(true);
    }
    expect(homePathForRole(null)).toBe("/");
  });
});
