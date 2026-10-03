import { describe, expect, it } from "vitest";
import type { Parsed } from "@/lib/admin/schemas";
import { parseResourceRuleForm, parseWalkInForm } from "@/lib/doctor/schemas";
import {
  parsePrepForm,
  parseProfileForm,
  parseProviderPriceForm,
  parseRefillForm,
  parseReservationForm,
  parseResultForm,
  parseStockForm,
  REFILL_NEXT,
  RESERVATION_NEXT,
  RESULT_MAX_BYTES,
} from "./schemas";

const ID = "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b";
const OTHER_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-05";

function form(values: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function errorsOf(result: Parsed<unknown>): string[] {
  if (result.ok) return [];
  return result.state && "errors" in result.state ? result.state.errors : [];
}

describe("facility profile form", () => {
  it("only carries contact details and hours", () => {
    const result = parseProfileForm(
      form({ phone: "043 123 4567", address_line: "1 Rizal St", hours_1_open: "08:00", hours_1_close: "17:00", name: "Hijacked" }),
    );
    expect(result).toEqual({
      ok: true,
      data: { phone: "043 123 4567", address_line: "1 Rizal St", hours: { "1": { open: "08:00", close: "17:00" } } },
    });
  });

  it("rejects malformed hours", () => {
    expect(errorsOf(parseProfileForm(form({ hours_1_open: "17:00", hours_1_close: "08:00" })))).toEqual([
      "invalidHours",
    ]);
  });
});

describe("provider price form", () => {
  it("stores integer centavos and never takes a source or date from the form", () => {
    const result = parseProviderPriceForm(
      form({ service_id: ID, amount_min: "350", amount_max: "500.50", source: "estimated", observed_at: "2020-01-01" }),
    );
    expect(result).toEqual({
      ok: true,
      data: { service_id: ID, amount_min_centavos: 35000, amount_max_centavos: 50050 },
    });
  });

  it("rejects a reversed range or a non-peso amount", () => {
    expect(errorsOf(parseProviderPriceForm(form({ service_id: ID, amount_min: "500", amount_max: "350" })))).toEqual([
      "priceRangeOrder",
    ]);
    expect(errorsOf(parseProviderPriceForm(form({ service_id: ID, amount_min: "1.234", amount_max: "2" })))).toEqual([
      "invalidAmount",
    ]);
  });
});

describe("preparation instructions form", () => {
  it("accepts instructions with optional fasting hours", () => {
    const result = parsePrepForm(form({ service_id: ID, locale: "fil", instructions: "Huwag kumain", fasting_hours: "8" }));
    expect(result.ok && result.data).toMatchObject({ locale: "fil", fasting_hours: 8 });
    expect(parsePrepForm(form({ service_id: ID, locale: "en", instructions: "Bring your ID" })).ok).toBe(true);
  });

  it("requires instructions and a supported language", () => {
    expect(errorsOf(parsePrepForm(form({ service_id: ID, locale: "en" })))).toContain("required");
    expect(errorsOf(parsePrepForm(form({ service_id: ID, locale: "ceb", instructions: "x" })))).toContain(
      "invalidChoice",
    );
  });
});

describe("resource rule form", () => {
  it("names the resource schedule rather than a clinic", () => {
    const result = parseResourceRuleForm(
      form({
        schedule_id: ID,
        weekday: "3",
        start_time: "07:00",
        end_time: "11:00",
        slot_minutes: "15",
        capacity_per_slot: "2",
        valid_from: TODAY,
      }),
    );
    expect(result.ok && result.data).toMatchObject({ schedule_id: ID, weekday: 3, capacity_per_slot: 2 });
  });
});

describe("home-service booking", () => {
  const base = { slot_id: ID, service_id: OTHER_ID, full_name: "Synthetic Patient", consent: "on" };

  it("needs an address when home service is ticked", () => {
    expect(errorsOf(parseWalkInForm(form({ ...base, home_service: "on" })))).toEqual(["homeAddressRequired"]);
    const result = parseWalkInForm(form({ ...base, home_service: "on", home_address: "12 Synthetic St" }));
    expect(result.ok && result.data).toMatchObject({ home_service: true, home_address: "12 Synthetic St" });
  });

  it("drops an address that was typed without ticking home service", () => {
    const result = parseWalkInForm(form({ ...base, home_address: "12 Synthetic St" }));
    expect(result.ok && result.data).toMatchObject({ home_service: false, home_address: null });
  });
});

describe("pharmacy forms", () => {
  it("records stock as a yes or no", () => {
    expect(parseStockForm(form({ service_id: ID, available: "true" }))).toEqual({
      ok: true,
      data: { service_id: ID, available: true },
    });
    expect(errorsOf(parseStockForm(form({ service_id: ID, available: "maybe" })))).toContain("invalidChoice");
  });

  const reservation = { service_id: ID, quantity: "2", hold_days: "2", full_name: "Synthetic Patient", consent: "on" };

  it("will not reserve without consent or without a patient", () => {
    expect(errorsOf(parseReservationForm(form({ ...reservation, consent: "" }), TODAY))).toEqual(["consentRequired"]);
    expect(
      errorsOf(parseReservationForm(form({ service_id: ID, quantity: "1", hold_days: "1", consent: "on" }), TODAY)),
    ).toEqual(["patientRequired"]);
  });

  it("holds until the end of the last hold day in Manila", () => {
    const result = parseReservationForm(form(reservation), TODAY);
    // Two days from the 5th is the 7th; the hold ends when the 8th begins in Manila.
    expect(result.ok && result.data.hold_until).toBe("2026-10-07T16:00:00.000Z");
  });

  it("limits quantity and hold length", () => {
    expect(errorsOf(parseReservationForm(form({ ...reservation, quantity: "0" }), TODAY))).toContain("invalidQuantity");
    expect(errorsOf(parseReservationForm(form({ ...reservation, hold_days: "30" }), TODAY))).toContain("invalidChoice");
  });

  it("does not accept a refill needed in the past", () => {
    const refill = { service_id: ID, full_name: "Synthetic Patient", consent: "on" };
    expect(parseRefillForm(form(refill), TODAY).ok).toBe(true);
    expect(errorsOf(parseRefillForm(form({ ...refill, needed_by: "2026-10-01" }), TODAY))).toEqual(["invalidDate"]);
  });

  it("offers only legal next steps, with nothing after a final state", () => {
    expect(RESERVATION_NEXT.reserved).toEqual(["ready", "cancelled"]);
    expect(RESERVATION_NEXT.picked_up).toEqual([]);
    expect(RESERVATION_NEXT.expired).toEqual([]);
    expect(REFILL_NEXT.requested).toEqual(["accepted", "declined"]);
    expect(REFILL_NEXT.accepted).not.toContain("declined");
    expect(REFILL_NEXT.picked_up).toEqual([]);
  });
});

describe("result delivery form", () => {
  const file = (type: string, size = 100) => new File([new Uint8Array(size)], "result", { type });
  const base = { appointment_id: ID, document_type: "lab_result" };

  it("accepts a PDF or an image", () => {
    const result = parseResultForm(form({ ...base, file: file("application/pdf") }));
    expect(result.ok && result.data.mime_type).toBe("application/pdf");
    expect(parseResultForm(form({ ...base, file: file("image/jpeg") })).ok).toBe(true);
  });

  it("rejects a missing, empty, oversized or wrong-type file", () => {
    expect(errorsOf(parseResultForm(form(base)))).toEqual(["fileRequired"]);
    expect(errorsOf(parseResultForm(form({ ...base, file: file("application/pdf", 0) })))).toEqual(["fileRequired"]);
    expect(errorsOf(parseResultForm(form({ ...base, file: file("application/pdf", RESULT_MAX_BYTES + 1) })))).toEqual([
      "fileTooLarge",
    ]);
    expect(errorsOf(parseResultForm(form({ ...base, file: file("application/x-msdownload") })))).toEqual([
      "fileTypeNotAllowed",
    ]);
  });

  it("only delivers results, not other vault document types", () => {
    expect(
      errorsOf(parseResultForm(form({ ...base, document_type: "prescription", file: file("application/pdf") }))),
    ).toContain("invalidChoice");
  });
});
