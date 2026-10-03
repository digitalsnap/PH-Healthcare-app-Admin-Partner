import type { FacilityType } from "@/lib/admin/schemas";

/** The three provider portals. Which one a facility gets follows its type. */
export type Segment = "clinic" | "diagnostics" | "pharmacy";

export const SECTIONS = [
  "catalogue",
  "schedule",
  "bookings",
  "calendar",
  "queue",
  "results",
  "stock",
  "reservations",
  "refills",
  "profile",
] as const;
export type Section = (typeof SECTIONS)[number];

const SEGMENT_OF: Partial<Record<FacilityType, Segment>> = {
  yakap_clinic: "clinic",
  private_clinic: "clinic",
  rhu: "clinic",
  health_center: "clinic",
  barangay_health_station: "clinic",
  diagnostic_center: "diagnostics",
  pharmacy: "pharmacy",
};

/** Hospitals have no portal yet, so they map to null. */
export function segmentOf(facilityType: FacilityType): Segment | null {
  return SEGMENT_OF[facilityType] ?? null;
}

/**
 * What each portal contains, in menu order. A section missing from a segment
 * does not exist for it: its pages return not-found and its actions refuse.
 */
const SEGMENT_SECTIONS: Record<Segment, readonly Section[]> = {
  clinic: ["queue", "bookings", "calendar", "schedule", "catalogue", "profile"],
  diagnostics: ["bookings", "calendar", "results", "schedule", "catalogue", "profile"],
  pharmacy: ["stock", "reservations", "refills", "catalogue", "profile"],
};

export function sectionsOf(segment: Segment): readonly Section[] {
  return SEGMENT_SECTIONS[segment];
}

export function hasSection(segment: Segment, section: Section): boolean {
  return SEGMENT_SECTIONS[segment].includes(section);
}
