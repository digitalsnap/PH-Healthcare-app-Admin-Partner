import { describe, expect, it } from "vitest";
import { calendarQuery, rangeFor } from "./calendar";

describe("rangeFor", () => {
  it("covers one day", () => {
    expect(rangeFor("day", "2026-10-07")).toEqual({
      start: "2026-10-07",
      end: "2026-10-08",
      previous: "2026-10-06",
      next: "2026-10-08",
    });
  });

  it("covers Monday to Sunday for any day of that week", () => {
    const week = { start: "2026-10-05", end: "2026-10-12", previous: "2026-09-28", next: "2026-10-12" };
    expect(rangeFor("week", "2026-10-05")).toEqual(week); // Monday
    expect(rangeFor("week", "2026-10-07")).toEqual(week); // Wednesday
    expect(rangeFor("week", "2026-10-11")).toEqual(week); // Sunday
  });

  it("covers the whole month, across year ends", () => {
    expect(rangeFor("month", "2026-10-17")).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
      previous: "2026-09-01",
      next: "2026-11-01",
    });
    expect(rangeFor("month", "2026-12-31")).toMatchObject({ end: "2027-01-01", next: "2027-01-01" });
    expect(rangeFor("month", "2027-01-15")).toMatchObject({ previous: "2026-12-01" });
  });
});

describe("calendarQuery", () => {
  const TODAY = "2026-10-03";

  it("defaults to this week", () => {
    expect(calendarQuery(undefined, undefined, TODAY)).toEqual({ view: "week", date: TODAY });
  });

  it("accepts a known view and a real date", () => {
    expect(calendarQuery("month", "2026-11-20", TODAY)).toEqual({ view: "month", date: "2026-11-20" });
  });

  it("falls back for anything it does not recognise", () => {
    expect(calendarQuery("year", "tomorrow", TODAY)).toEqual({ view: "week", date: TODAY });
    expect(calendarQuery("day", "2026-13-45", TODAY)).toEqual({ view: "day", date: TODAY });
    expect(calendarQuery("day", "2026-10-3", TODAY)).toEqual({ view: "day", date: TODAY });
  });
});
