import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES } from "./index";
import { canCancel, canMarkNoShow, canReschedule, canTransition, nextSteps } from "./transitions";

const NOW = new Date("2026-10-05T02:00:00Z");

describe("appointment transitions", () => {
  it("walks the front-office path in order", () => {
    expect(canTransition("booked", "checked_in")).toBe(true);
    expect(canTransition("checked_in", "seen")).toBe(true);
    expect(canTransition("seen", "completed")).toBe(true);
    expect(nextSteps("booked")).toEqual(["checked_in"]);
    expect(nextSteps("seen")).toEqual(["completed"]);
  });

  it("never skips a step or goes backwards", () => {
    expect(canTransition("booked", "seen")).toBe(false);
    expect(canTransition("booked", "completed")).toBe(false);
    expect(canTransition("seen", "booked")).toBe(false);
    expect(canTransition("checked_in", "booked")).toBe(false);
  });

  it("treats completed, cancelled and no-show as final", () => {
    for (const final of ["completed", "cancelled", "no_show"] as const) {
      for (const next of APPOINTMENT_STATUSES) {
        expect(canTransition(final, next)).toBe(false);
      }
    }
  });

  it("allows cancelling only before the patient is seen", () => {
    expect(canCancel("booked")).toBe(true);
    expect(canCancel("checked_in")).toBe(true);
    expect(canCancel("seen")).toBe(false);
    expect(canCancel("completed")).toBe(false);
  });

  it("allows a no-show only once the slot has started", () => {
    expect(canMarkNoShow("booked", "2026-10-05T01:30:00Z", NOW)).toBe(true);
    expect(canMarkNoShow("booked", "2026-10-05T02:00:00Z", NOW)).toBe(true);
    expect(canMarkNoShow("booked", "2026-10-05T02:30:00Z", NOW)).toBe(false);
    expect(canMarkNoShow("seen", "2026-10-05T01:30:00Z", NOW)).toBe(false);
  });

  it("allows a reschedule only while booked and only into the future", () => {
    expect(canReschedule("booked", "2026-10-06T01:00:00Z", NOW)).toBe(true);
    expect(canReschedule("booked", "2026-10-05T01:00:00Z", NOW)).toBe(false);
    expect(canReschedule("checked_in", "2026-10-06T01:00:00Z", NOW)).toBe(false);
    expect(canReschedule("cancelled", "2026-10-06T01:00:00Z", NOW)).toBe(false);
  });
});
