import { describe, expect, it } from "vitest";
import { FACILITY_TYPES } from "@/lib/admin/schemas";
import { hasSection, sectionsOf, segmentOf } from "./segments";

describe("provider segments", () => {
  it("gives each facility type its portal, and hospitals none", () => {
    expect(segmentOf("yakap_clinic")).toBe("clinic");
    expect(segmentOf("rhu")).toBe("clinic");
    expect(segmentOf("diagnostic_center")).toBe("diagnostics");
    expect(segmentOf("pharmacy")).toBe("pharmacy");
    expect(segmentOf("hospital_public")).toBeNull();
    expect(segmentOf("hospital_private")).toBeNull();
    expect(FACILITY_TYPES.filter((type) => segmentOf(type) === null)).toEqual([
      "hospital_public",
      "hospital_private",
    ]);
  });

  it("scopes each portal to its own sections", () => {
    expect(hasSection("clinic", "queue")).toBe(true);
    expect(hasSection("clinic", "stock")).toBe(false);
    expect(hasSection("clinic", "results")).toBe(false);

    expect(hasSection("diagnostics", "results")).toBe(true);
    expect(hasSection("diagnostics", "queue")).toBe(false);
    expect(hasSection("diagnostics", "reservations")).toBe(false);

    expect(hasSection("pharmacy", "stock")).toBe(true);
    expect(hasSection("pharmacy", "refills")).toBe(true);
    expect(hasSection("pharmacy", "bookings")).toBe(false);
    expect(hasSection("pharmacy", "schedule")).toBe(false);
    expect(hasSection("pharmacy", "calendar")).toBe(false);
    expect(hasSection("clinic", "calendar")).toBe(true);
    expect(hasSection("diagnostics", "calendar")).toBe(true);
  });

  it("gives every portal a profile and a catalogue", () => {
    for (const segment of ["clinic", "diagnostics", "pharmacy"] as const) {
      expect(sectionsOf(segment)).toContain("profile");
      expect(sectionsOf(segment)).toContain("catalogue");
    }
  });
});
