/**
 * Which dates a calendar view covers. Shared by the doctor dashboard and the
 * provider portals. All dates are Manila calendar dates (YYYY-MM-DD).
 */

import { addDays, isoWeekday } from "./generate";

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarViewName = (typeof CALENDAR_VIEWS)[number];

export type CalendarRange = {
  /** First date shown. */
  start: string;
  /** The date after the last one shown. */
  end: string;
  /** A date in the previous / next period, for the navigation links. */
  previous: string;
  next: string;
};

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

function shiftMonth(date: string, by: 1 | -1): string {
  const [year, month] = date.split("-").map(Number);
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Weeks run Monday to Sunday. */
export function rangeFor(view: CalendarViewName, date: string): CalendarRange {
  if (view === "day") {
    return { start: date, end: addDays(date, 1), previous: addDays(date, -1), next: addDays(date, 1) };
  }
  if (view === "week") {
    const start = addDays(date, 1 - isoWeekday(date));
    return { start, end: addDays(start, 7), previous: addDays(start, -7), next: addDays(start, 7) };
  }
  const start = firstOfMonth(date);
  return { start, end: shiftMonth(start, 1), previous: shiftMonth(start, -1), next: shiftMonth(start, 1) };
}

/** The view and date a query string asks for; anything invalid falls back to this week. */
export function calendarQuery(
  view: string | undefined,
  date: string | undefined,
  today: string,
): { view: CalendarViewName; date: string } {
  const validDate =
    date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  return {
    view: CALENDAR_VIEWS.find((option) => option === view) ?? "week",
    date: validDate ? date : today,
  };
}
