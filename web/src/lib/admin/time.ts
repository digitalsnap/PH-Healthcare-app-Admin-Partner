/**
 * Instants are stored in UTC and shown in Asia/Manila. The Philippines has one
 * zone and no DST, so the offset is a constant — stated here rather than taken
 * from wherever the server happens to run.
 */
export const MANILA_OFFSET = "+08:00";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The UTC instant at which a Manila calendar date (YYYY-MM-DD) begins. */
export function manilaDateToUtcIso(date: string): string {
  return new Date(`${date}T00:00:00${MANILA_OFFSET}`).toISOString();
}

/** The Manila calendar date (YYYY-MM-DD) of a UTC instant. */
export function utcIsoToManilaDate(iso: string): string {
  return new Date(new Date(iso).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's calendar date in Manila. */
export function manilaToday(now: Date = new Date()): string {
  return utcIsoToManilaDate(now.toISOString());
}
