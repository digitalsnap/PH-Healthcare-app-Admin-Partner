/** How stale a listing's verification is. Drives the "last verified" badge. */
export type Freshness = "fresh" | "amber" | "red" | "never";

export const AMBER_AFTER_DAYS = 60;
export const RED_AFTER_DAYS = 90;
export const STOCK_REPORT_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `days` before `now`, as a UTC ISO string for query filters. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Amber past 60 days, red past 90, and "never" when nothing is recorded. */
export function freshnessOf(lastVerifiedAt: string | null, now: Date = new Date()): Freshness {
  if (!lastVerifiedAt) return "never";
  const ageMs = now.getTime() - new Date(lastVerifiedAt).getTime();
  if (ageMs > RED_AFTER_DAYS * DAY_MS) return "red";
  if (ageMs > AMBER_AFTER_DAYS * DAY_MS) return "amber";
  return "fresh";
}

/** Share as a whole percentage; an empty set is 0%, not NaN. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
