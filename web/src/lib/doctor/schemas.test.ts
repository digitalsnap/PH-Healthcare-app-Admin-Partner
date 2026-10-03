import { describe, expect, it } from "vitest";
import type { Parsed } from "@/lib/admin/schemas";
import {
  parseCancelForm,
  parseExceptionForm,
  parseRuleForm,
  parseStatusForm,
  parseWalkInForm,
  ruleFormFromQuery,
} from "./schemas";

const ID = "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b";
const OTHER_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function errorsOf(result: Parsed<unknown>): string[] {
  if (result.ok) return [];
  return result.state && "errors" in result.state ? result.state.errors : [];
}

describe("availability rule form", () => {
  const valid = {
    facility_id: ID,
    weekday: "1",
    start_time: "09:00",
    end_time: "12:00",
    slot_minutes: "30",
    capacity_per_slot: "1",
    valid_from: "2026-10-05",
  };

  it("parses numbers", () => {
    const result = parseRuleForm(form(valid));
    expect(result.ok && result.data).toMatchObject({
      weekday: 1,
      slot_minutes: 30,
      capacity_per_slot: 1,
    });
    // Buffers are not offered: slots run back to back.
    expect(result.ok && "buffer_before_minutes" in result.data).toBe(false);
  });

  it("reads the same fields from a preview query string", () => {
    const result = parseRuleForm(ruleFormFromQuery({ ...valid, page: "2", weekday: ["3", "4"] }));
    expect(result.ok && result.data.weekday).toBe(3);
  });

  it("rejects an end time at or before the start", () => {
    expect(errorsOf(parseRuleForm(form({ ...valid, end_time: "09:00" })))).toEqual(["timesOrder"]);
    expect(errorsOf(parseRuleForm(form({ ...valid, end_time: "08:00" })))).toEqual(["timesOrder"]);
  });

  it("rejects a slot that cannot fit in the session", () => {
    expect(errorsOf(parseRuleForm(form({ ...valid, slot_minutes: "240" })))).toEqual(["invalidSlotLength"]);
    expect(parseRuleForm(form({ ...valid, slot_minutes: "180" })).ok).toBe(true);
  });

  it("rejects an impossible weekday, capacity or date range", () => {
    expect(errorsOf(parseRuleForm(form({ ...valid, weekday: "8" })))).toContain("invalidChoice");
    expect(errorsOf(parseRuleForm(form({ ...valid, capacity_per_slot: "0" })))).toContain("required");
    expect(errorsOf(parseRuleForm(form({ ...valid, valid_to: "2026-10-01" })))).toEqual(["datesOrder"]);
  });
});

describe("schedule exception form", () => {
  it("blocks whole Manila days, inclusive of the last day", () => {
    const result = parseExceptionForm(
      form({ schedule_id: ID, exception_type: "leave", start_date: "2026-12-24", end_date: "2026-12-26" }),
    );
    expect(result.ok && result.data).toMatchObject({
      exception_type: "leave",
      starts_at: "2026-12-23T16:00:00.000Z",
      ends_at: "2026-12-26T16:00:00.000Z",
      slot_minutes: null,
    });
  });

  it("treats a missing last day as a single day", () => {
    const result = parseExceptionForm(
      form({ schedule_id: ID, exception_type: "holiday", start_date: "2026-12-25" }),
    );
    expect(result.ok && [result.data.starts_at, result.data.ends_at]).toEqual([
      "2026-12-24T16:00:00.000Z",
      "2026-12-25T16:00:00.000Z",
    ]);
  });

  it("stores an extra session as UTC instants with its own slicing", () => {
    const result = parseExceptionForm(
      form({
        schedule_id: ID,
        exception_type: "extra_session",
        start_date: "2026-10-10",
        start_time: "14:00",
        end_time: "16:00",
        slot_minutes: "20",
        capacity_per_slot: "2",
      }),
    );
    expect(result.ok && result.data).toEqual({
      schedule_id: ID,
      exception_type: "extra_session",
      starts_at: "2026-10-10T06:00:00.000Z",
      ends_at: "2026-10-10T08:00:00.000Z",
      slot_minutes: 20,
      capacity_per_slot: 2,
      mode: "in_person",
    });
  });

  it("rejects reversed dates and unknown types", () => {
    expect(
      errorsOf(
        parseExceptionForm(
          form({ schedule_id: ID, exception_type: "leave", start_date: "2026-12-26", end_date: "2026-12-24" }),
        ),
      ),
    ).toEqual(["datesOrder"]);
    expect(
      errorsOf(parseExceptionForm(form({ schedule_id: ID, exception_type: "strike", start_date: "2026-12-26" }))),
    ).toContain("invalidChoice");
  });
});

describe("walk-in form", () => {
  const valid = { slot_id: ID, service_id: OTHER_ID, full_name: "Synthetic Patient", consent: "on" };

  it("will not book without the patient's consent", () => {
    expect(errorsOf(parseWalkInForm(form({ ...valid, consent: "" })))).toEqual(["consentRequired"]);
  });

  it("needs either a returning patient or a name", () => {
    expect(errorsOf(parseWalkInForm(form({ slot_id: ID, service_id: OTHER_ID, consent: "on" })))).toEqual([
      "patientRequired",
    ]);
  });

  it("normalises Philippine mobile numbers to +63", () => {
    const local = parseWalkInForm(form({ ...valid, phone: "0917 123 4567" }));
    expect(local.ok && local.data.phone).toBe("+639171234567");
    const international = parseWalkInForm(form({ ...valid, phone: "+63917-123-4567" }));
    expect(international.ok && international.data.phone).toBe("+639171234567");
    expect(errorsOf(parseWalkInForm(form({ ...valid, phone: "12345" })))).toEqual(["invalidPhone"]);
  });

  it("does not overwrite a returning patient's details from the form", () => {
    const result = parseWalkInForm(form({ ...valid, patient_id: ID, phone: "09171234567" }));
    expect(result.ok && result.data).toMatchObject({ patient_id: ID, full_name: null, phone: null });
  });
});

describe("appointment forms", () => {
  it("requires a listed reason to cancel", () => {
    expect(parseCancelForm(form({ id: ID, cancel_reason: "patient_request" })).ok).toBe(true);
    expect(errorsOf(parseCancelForm(form({ id: ID })))).toEqual(["reasonRequired"]);
    expect(errorsOf(parseCancelForm(form({ id: ID, cancel_reason: "bored" })))).toEqual(["reasonRequired"]);
  });

  it("cannot set cancelled or booked through the status form", () => {
    expect(parseStatusForm(form({ id: ID, status: "checked_in" })).ok).toBe(true);
    expect(errorsOf(parseStatusForm(form({ id: ID, status: "cancelled" })))).toEqual(["transitionNotAllowed"]);
    expect(errorsOf(parseStatusForm(form({ id: ID, status: "booked" })))).toEqual(["transitionNotAllowed"]);
  });
});
