import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  generateSlots,
  groupByManilaDate,
  isoWeekday,
  type ExceptionInput,
  type RuleInput,
} from "./generate";

// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";

const rule = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  id: "rule-1",
  weekday: 1,
  recurrence: null,
  startTime: "09:00",
  endTime: "12:00",
  slotMinutes: 30,
  capacityPerSlot: 1,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  mode: "in_person",
  validFrom: "2026-01-01",
  validTo: null,
  ...overrides,
});

const generate = (rules: RuleInput[], exceptions: ExceptionInput[] = [], days = 7) =>
  generateSlots({
    timeZone: "Asia/Manila",
    rules,
    exceptions,
    windowStart: MONDAY,
    windowEnd: addDays(MONDAY, days),
  });

describe("calendar helpers", () => {
  it("knows ISO weekdays", () => {
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(isoWeekday("2026-10-11")).toBe(7);
  });

  it("walks dates", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(datesBetween("2026-10-05", "2026-10-08")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });
});

describe("generateSlots", () => {
  it("turns a weekly session into UTC slots on the right day", () => {
    const slots = generate([rule()]);
    expect(slots).toHaveLength(6);
    // 09:00 Manila on Monday is 01:00 UTC the same day.
    expect(slots[0]).toEqual({
      startsAt: "2026-10-05T01:00:00.000Z",
      endsAt: "2026-10-05T01:30:00.000Z",
      capacity: 1,
      mode: "in_person",
      availabilityRuleId: "rule-1",
      scheduleExceptionId: null,
    });
    expect(slots[5].startsAt).toBe("2026-10-05T03:30:00.000Z");
  });

  it("produces one slot per week within the window", () => {
    const slots = generate([rule({ slotMinutes: 180 })], [], 21);
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      "2026-10-05T01:00:00.000Z",
      "2026-10-12T01:00:00.000Z",
      "2026-10-19T01:00:00.000Z",
    ]);
  });

  it("drops a slot that would run past the session end", () => {
    const slots = generate([rule({ slotMinutes: 45 })]);
    expect(slots).toHaveLength(4); // 09:00, 09:45, 10:30, 11:15 — 12:00 would end at 12:45
  });

  it("pads each appointment with its buffers", () => {
    const slots = generate([rule({ slotMinutes: 20, bufferBeforeMinutes: 5, bufferAfterMinutes: 5 })]);
    expect(slots.slice(0, 2).map((slot) => [slot.startsAt, slot.endsAt])).toEqual([
      ["2026-10-05T01:05:00.000Z", "2026-10-05T01:25:00.000Z"],
      ["2026-10-05T01:35:00.000Z", "2026-10-05T01:55:00.000Z"],
    ]);
  });

  it("respects valid_from and valid_to", () => {
    expect(generate([rule({ validFrom: "2026-10-06" })])).toHaveLength(0);
    expect(generate([rule({ validTo: "2026-10-04" })])).toHaveLength(0);
    expect(generate([rule({ validFrom: MONDAY, validTo: MONDAY })])).toHaveLength(6);
  });

  it("models a first-come-first-served block as one slot with capacity", () => {
    const slots = generate([rule({ slotMinutes: 180, capacityPerSlot: 20 })]);
    expect(slots).toHaveLength(1);
    expect(slots[0].capacity).toBe(20);
  });

  it("keeps two clinics' rules apart and lets the first win on a clash", () => {
    const clinicA = rule({ id: "a", startTime: "09:00", endTime: "10:00" });
    const clinicB = rule({ id: "b", startTime: "09:30", endTime: "10:30", capacityPerSlot: 3 });
    const slots = generate([clinicA, clinicB]);
    expect(slots.map((slot) => [slot.startsAt.slice(11, 16), slot.availabilityRuleId, slot.capacity])).toEqual([
      ["01:00", "a", 1],
      ["01:30", "a", 1],
      ["02:00", "b", 3],
    ]);
  });

  it("removes slots under a blackout, holiday or leave", () => {
    const leave: ExceptionInput = {
      id: "leave-1",
      type: "leave",
      startsAt: "2026-10-05T02:00:00.000Z", // 10:00 Manila
      endsAt: "2026-10-05T02:45:00.000Z", // 10:45 Manila, overlaps the 10:30 slot
      slotMinutes: null,
      capacityPerSlot: null,
      mode: null,
    };
    const slots = generate([rule()], [leave]);
    expect(slots.map((slot) => slot.startsAt.slice(11, 16))).toEqual(["01:00", "01:30", "03:00", "03:30"]);
  });

  it("adds an extra session, sliced by its own settings", () => {
    const extra: ExceptionInput = {
      id: "extra-1",
      type: "extra_session",
      startsAt: "2026-10-10T06:00:00.000Z", // Saturday 14:00 Manila
      endsAt: "2026-10-10T07:00:00.000Z",
      slotMinutes: 20,
      capacityPerSlot: 2,
      mode: "in_person",
    };
    const slots = generate([], [extra]);
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ capacity: 2, scheduleExceptionId: "extra-1", availabilityRuleId: null });
  });

  it("lets a blackout cancel an extra session too", () => {
    const extra: ExceptionInput = {
      id: "extra-1",
      type: "extra_session",
      startsAt: "2026-10-10T06:00:00.000Z",
      endsAt: "2026-10-10T07:00:00.000Z",
      slotMinutes: 30,
      capacityPerSlot: 1,
      mode: "in_person",
    };
    const blackout: ExceptionInput = {
      id: "blackout-1",
      type: "blackout",
      startsAt: "2026-10-10T00:00:00.000Z",
      endsAt: "2026-10-11T00:00:00.000Z",
      slotMinutes: null,
      capacityPerSlot: null,
      mode: null,
    };
    expect(generate([], [extra, blackout])).toHaveLength(0);
  });

  it("never emits a slot outside the window", () => {
    const slots = generate([rule({ weekday: 7 })], [], 6); // window ends before Sunday
    expect(slots).toHaveLength(0);
  });

  it("generates nothing for RRULE recurrences yet", () => {
    expect(generate([rule({ weekday: null, recurrence: "FREQ=WEEKLY;INTERVAL=2" })])).toHaveLength(0);
  });

  it("refuses a timezone it cannot convert", () => {
    expect(() =>
      generateSlots({ timeZone: "Asia/Tokyo", rules: [], exceptions: [], windowStart: MONDAY, windowEnd: MONDAY }),
    ).toThrow(/timezone/);
  });

  it("groups slots by Manila date, not UTC date", () => {
    // 00:30 Manila on Tuesday is 16:30 UTC on Monday.
    const slots = generate([rule({ weekday: 2, startTime: "00:30", endTime: "01:00" })]);
    expect(slots[0].startsAt).toBe("2026-10-05T16:30:00.000Z");
    expect([...groupByManilaDate(slots).keys()]).toEqual(["2026-10-06"]);
  });
});
