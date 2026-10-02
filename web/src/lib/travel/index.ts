/**
 * Travel estimates — types only for now. Computed server-side from a patient's
 * barangay or municipality (PSGC) to a facility.
 */

import type { MoneyRange } from "@/lib/money";

export const TRAVEL_MODES = [
  "tricycle",
  "habal_habal",
  "jeepney",
  "van",
  "bus",
  "boat",
  "ferry",
] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export type MinutesRange = {
  min: number;
  max: number;
};

export type TravelLeg = {
  mode: TravelMode;
  fare: MoneyRange;
  duration: MinutesRange;
  /** Sea legs can be cancelled in bad weather. */
  weatherDependent: boolean;
};

export type TravelEstimate = {
  originPsgcCode: string;
  destinationFacilityId: string;
  legs: TravelLeg[];
  /** Always a range. */
  totalFare: MoneyRange;
  totalDuration: MinutesRange;
  source: "partner_reported" | "patient_reported" | "estimated";
  /** UTC ISO 8601 instant. */
  observedAt: string;
};
