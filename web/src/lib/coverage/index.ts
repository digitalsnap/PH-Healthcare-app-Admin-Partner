/**
 * Coverage stacking — types only for now. The engine is server-side business
 * logic; the Kotlin and Swift clients render its result and never re-implement
 * it.
 */

import type { MoneyRange } from "@/lib/money";

/** The fixed stacking order. */
export const COVERAGE_STACK_ORDER = [
  "facility_price",
  "hmo",
  "philhealth_benefit",
  "gamot_balance",
  "senior_pwd_discount",
  "travel_estimate",
] as const;

export type CoverageLayer = (typeof COVERAGE_STACK_ORDER)[number];

export const PRICE_SOURCES = ["facility_confirmed", "patient_reported", "estimated"] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Every estimate says where its numbers came from. */
export type SourceLabel =
  | { source: "facility_confirmed"; confirmedAt: string }
  | { source: "patient_reported"; reportCount: number; latestReportAt: string }
  | { source: "estimated" };

/** Where a balance (YAKAP, GAMOT) came from. Patient-entered unless officially connected. */
export type BalanceOrigin = "patient_entered" | "official_connection";

export type CoverageStep = {
  layer: CoverageLayer;
  /** What is left to pay after this layer is applied. */
  remaining: MoneyRange;
  balanceOrigin?: BalanceOrigin;
};

export type CostEstimate = {
  /** Always a range, never a single guaranteed number. */
  outOfPocket: MoneyRange;
  outOfPocketWithTravel: MoneyRange;
  steps: CoverageStep[];
  sourceLabel: SourceLabel;
  /** i18n key of the "final billing is set by the facility" disclaimer; always present. */
  disclaimerKey: "estimate.disclaimer";
};
