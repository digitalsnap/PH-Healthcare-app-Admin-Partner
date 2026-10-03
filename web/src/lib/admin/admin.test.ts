import { describe, expect, it } from "vitest";
import { daysAgoIso, freshnessOf, percentOf } from "./freshness";
import { pageCount, pageHref, pageOf, param, rangeOf } from "./pagination";
import {
  parseAccountForm,
  parseAccreditationForm,
  parseCoverageProgramForm,
  parseFacilityForm,
  parseInviteForm,
  parsePractitionerForm,
  parsePrcVerificationForm,
  parsePriceForm,
  type Parsed,
} from "./schemas";
import { manilaDateToUtcIso, manilaToday, utcIsoToManilaDate } from "./time";

const ID = "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b";
const OTHER_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-02";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function errorsOf(result: Parsed<unknown>): string[] {
  if (result.ok) return [];
  return result.state && "errors" in result.state ? result.state.errors : [];
}

describe("freshness", () => {
  const now = new Date("2026-10-02T00:00:00Z");

  it("is fresh up to 60 days, amber past 60, red past 90", () => {
    expect(freshnessOf(daysAgoIso(0, now), now)).toBe("fresh");
    expect(freshnessOf(daysAgoIso(60, now), now)).toBe("fresh");
    expect(freshnessOf(daysAgoIso(61, now), now)).toBe("amber");
    expect(freshnessOf(daysAgoIso(90, now), now)).toBe("amber");
    expect(freshnessOf(daysAgoIso(91, now), now)).toBe("red");
  });

  it("treats a listing with no verification as never verified", () => {
    expect(freshnessOf(null, now)).toBe("never");
  });

  it("computes a share without dividing by zero", () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(3, 3)).toBe(100);
  });
});

describe("Manila time", () => {
  it("stores a Manila calendar date as the UTC instant it begins", () => {
    expect(manilaDateToUtcIso("2026-10-02")).toBe("2026-10-01T16:00:00.000Z");
  });

  it("reads the Manila date back from a UTC instant", () => {
    expect(utcIsoToManilaDate("2026-10-01T16:00:00.000Z")).toBe("2026-10-02");
    expect(utcIsoToManilaDate("2026-10-01T15:59:59.000Z")).toBe("2026-10-01");
  });

  it("knows today in Manila even when UTC is still on yesterday", () => {
    expect(manilaToday(new Date("2026-10-01T20:00:00Z"))).toBe("2026-10-02");
  });
});

describe("pagination", () => {
  it("falls back to page 1 for anything invalid", () => {
    expect(pageOf({})).toBe(1);
    expect(pageOf({ page: "0" })).toBe(1);
    expect(pageOf({ page: "-2" })).toBe(1);
    expect(pageOf({ page: "abc" })).toBe(1);
    expect(pageOf({ page: "3" })).toBe(3);
  });

  it("computes inclusive row ranges and page counts", () => {
    expect(rangeOf(1)).toEqual([0, 19]);
    expect(rangeOf(3)).toEqual([40, 59]);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
  });

  it("keeps filters in page links and drops empty ones", () => {
    expect(pageHref("/admin/facilities", { type: "pharmacy", status: "", page: "2" }, 3)).toBe(
      "/admin/facilities?type=pharmacy&page=3",
    );
    expect(pageHref("/admin/facilities", { page: "2" }, 1)).toBe("/admin/facilities");
    expect(param({ type: ["rhu", "pharmacy"] }, "type")).toBe("rhu");
  });
});

describe("price form", () => {
  const valid = {
    facility_id: ID,
    service_id: OTHER_ID,
    amount_min: "350",
    amount_max: "500.50",
    source: "facility_confirmed",
    observed_on: "2026-09-30",
  };

  it("stores integer centavos and a UTC observed_at", () => {
    const result = parsePriceForm(form(valid), TODAY);
    expect(result).toEqual({
      ok: true,
      data: {
        facility_id: ID,
        service_id: OTHER_ID,
        amount_min_centavos: 35000,
        amount_max_centavos: 50050,
        source: "facility_confirmed",
        observed_at: "2026-09-29T16:00:00.000Z",
        report_count: null,
      },
    });
  });

  it("never saves a price without a source", () => {
    expect(errorsOf(parsePriceForm(form({ ...valid, source: "" }), TODAY))).toContain("sourceRequired");
    expect(errorsOf(parsePriceForm(form({ ...valid, source: "guess" }), TODAY))).toContain(
      "sourceRequired",
    );
  });

  it("never saves a price without an observed date", () => {
    expect(errorsOf(parsePriceForm(form({ ...valid, observed_on: "" }), TODAY))).toContain(
      "observedAtRequired",
    );
  });

  it("rejects an observed date in the future", () => {
    expect(errorsOf(parsePriceForm(form({ ...valid, observed_on: "2026-10-03" }), TODAY))).toEqual([
      "observedAtInFuture",
    ]);
  });

  it("rejects a range whose max is below its min", () => {
    expect(errorsOf(parsePriceForm(form({ ...valid, amount_max: "100" }), TODAY))).toEqual([
      "priceRangeOrder",
    ]);
  });

  it("rejects amounts that are not pesos and centavos", () => {
    expect(errorsOf(parsePriceForm(form({ ...valid, amount_min: "12.345" }), TODAY))).toEqual([
      "invalidAmount",
    ]);
    expect(errorsOf(parsePriceForm(form({ ...valid, amount_min: "-5" }), TODAY))).toEqual([
      "invalidAmount",
    ]);
  });

  it("needs a report count for patient-reported prices, and only for those", () => {
    const patient = { ...valid, source: "patient_reported" };
    expect(errorsOf(parsePriceForm(form(patient), TODAY))).toEqual(["reportCountRequired"]);

    const withCount = parsePriceForm(form({ ...patient, report_count: "4" }), TODAY);
    expect(withCount.ok && withCount.data.report_count).toBe(4);

    const ignored = parsePriceForm(form({ ...valid, report_count: "4" }), TODAY);
    expect(ignored.ok && ignored.data.report_count).toBeNull();
  });
});

describe("PRC verification form", () => {
  const valid = { id: ID, prc_number: "0123456", prc_licence_expires_on: "2028-05-31" };

  it("accepts a PRC number with a licence expiry", () => {
    expect(parsePrcVerificationForm(form(valid), TODAY)).toEqual({ ok: true, data: valid });
  });

  it("cannot verify without the PRC number", () => {
    expect(errorsOf(parsePrcVerificationForm(form({ ...valid, prc_number: "" }), TODAY))).toContain(
      "prcNumberRequired",
    );
  });

  it("cannot verify without the licence expiry", () => {
    expect(
      errorsOf(parsePrcVerificationForm(form({ ...valid, prc_licence_expires_on: "" }), TODAY)),
    ).toContain("prcExpiryRequired");
  });

  it("cannot verify an expired licence", () => {
    expect(
      errorsOf(parsePrcVerificationForm(form({ ...valid, prc_licence_expires_on: "2026-10-01" }), TODAY)),
    ).toEqual(["prcExpiryPast"]);
    expect(parsePrcVerificationForm(form({ ...valid, prc_licence_expires_on: TODAY }), TODAY).ok).toBe(
      true,
    );
  });
});

describe("practitioner form", () => {
  it("splits specialties and leaves the PRC number optional", () => {
    const result = parsePractitionerForm(
      form({ full_name: "Synthetic Doctor", specialties: " Pediatrics, ,Family Medicine " }),
    );
    expect(result).toEqual({
      ok: true,
      data: { full_name: "Synthetic Doctor", specialties: ["Pediatrics", "Family Medicine"] },
    });
  });

  it("requires a name", () => {
    expect(errorsOf(parsePractitionerForm(form({ full_name: "  " })))).toEqual(["nameRequired"]);
  });
});

describe("facility form", () => {
  const valid = { name: "Test Clinic", facility_type: "pharmacy", municipality_code: "9901001000" };

  it("accepts the minimum and builds no point, hours or licences", () => {
    const result = parseFacilityForm(form(valid));
    expect(result.ok && result.data).toMatchObject({
      name: "Test Clinic",
      barangay_code: null,
      geog: null,
      hours: {},
      licences: [],
    });
  });

  it("builds the PostGIS point as longitude then latitude", () => {
    const result = parseFacilityForm(form({ ...valid, latitude: "13.7565", longitude: "121.0583" }));
    expect(result.ok && result.data.geog).toBe("SRID=4326;POINT(121.0583 13.7565)");
  });

  it("catches swapped or partial coordinates", () => {
    expect(
      errorsOf(parseFacilityForm(form({ ...valid, latitude: "121.0583", longitude: "13.7565" }))),
    ).toEqual(["invalidCoordinates"]);
    expect(errorsOf(parseFacilityForm(form({ ...valid, latitude: "13.7565" })))).toEqual([
      "coordinatesIncomplete",
    ]);
  });

  it("reads hours per weekday and rejects a close before open", () => {
    const result = parseFacilityForm(form({ ...valid, hours_1_open: "08:00", hours_1_close: "17:00" }));
    expect(result.ok && result.data.hours).toEqual({ "1": { open: "08:00", close: "17:00" } });
    expect(
      errorsOf(parseFacilityForm(form({ ...valid, hours_1_open: "17:00", hours_1_close: "08:00" }))),
    ).toEqual(["invalidHours"]);
    expect(errorsOf(parseFacilityForm(form({ ...valid, hours_2_open: "08:00" })))).toEqual([
      "invalidHours",
    ]);
  });

  it("needs a type and number for each licence row that is used", () => {
    const result = parseFacilityForm(
      form({ ...valid, licence_0_kind: "fda_lto", licence_0_number: "LTO-1", licence_0_expires_on: "2027-01-01" }),
    );
    expect(result.ok && result.data.licences).toEqual([
      { kind: "fda_lto", number: "LTO-1", expires_on: "2027-01-01" },
    ]);
    expect(errorsOf(parseFacilityForm(form({ ...valid, licence_0_number: "LTO-1" })))).toEqual([
      "licenceIncomplete",
    ]);
  });

  it("rejects an unknown type or a malformed PSGC code", () => {
    expect(errorsOf(parseFacilityForm(form({ ...valid, facility_type: "spa" })))).toContain(
      "invalidChoice",
    );
    expect(errorsOf(parseFacilityForm(form({ ...valid, municipality_code: "123" })))).toContain(
      "invalidChoice",
    );
    expect(errorsOf(parseFacilityForm(form({ ...valid, name: "" })))).toContain("nameRequired");
  });
});

describe("coverage forms", () => {
  const program = {
    program_type: "gamot",
    code: "gamot_2026",
    name: "GAMOT",
    rules_version: "2026.1",
    source_url: "https://example.org/gamot",
  };

  it("requires a source link on every program", () => {
    expect(parseCoverageProgramForm(form(program)).ok).toBe(true);
    expect(errorsOf(parseCoverageProgramForm(form({ ...program, source_url: "" })))).toContain(
      "invalidUrl",
    );
    expect(
      errorsOf(parseCoverageProgramForm(form({ ...program, source_url: "javascript:alert(1)" }))),
    ).toContain("invalidUrl");
  });

  const accreditation = {
    facility_id: ID,
    coverage_program_id: OTHER_ID,
    valid_from: "2026-01-01",
    source: "Official accredited list",
  };

  it("requires a source and ordered dates on an accreditation", () => {
    expect(parseAccreditationForm(form(accreditation)).ok).toBe(true);
    expect(errorsOf(parseAccreditationForm(form({ ...accreditation, source: "" })))).toContain(
      "sourceRequired",
    );
    expect(
      errorsOf(parseAccreditationForm(form({ ...accreditation, valid_to: "2025-12-31" }))),
    ).toEqual(["datesOrder"]);
  });
});

describe("account forms", () => {
  it("only invites into one of the four console roles", () => {
    const invite = { email: "rep@example.org", display_name: "Field Rep", role: "staff" };
    expect(parseInviteForm(form(invite)).ok).toBe(true);
    expect(errorsOf(parseInviteForm(form({ ...invite, role: "superuser" })))).toContain("invalidChoice");
    expect(errorsOf(parseInviteForm(form({ ...invite, email: "not-an-email" })))).toContain(
      "invalidEmail",
    );
  });

  it("allows removing a role but not inventing one", () => {
    const result = parseAccountForm(form({ id: ID, role: "", is_active: "false" }));
    expect(result).toEqual({ ok: true, data: { id: ID, is_active: false } });
    expect(errorsOf(parseAccountForm(form({ id: ID, role: "root", is_active: "true" })))).toContain(
      "invalidChoice",
    );
  });
});
