import type { PriceSource } from "@/lib/coverage";
import type { AppRole } from "@/lib/auth/roles";
import type {
  CoverageProgramType,
  FacilityHours,
  FacilityLicence,
  FacilityType,
  ServiceType,
  VerificationStatus,
} from "./schemas";

/** Rows as the console reads them. Timestamps are UTC ISO strings. */

export type FacilityRow = {
  id: string;
  name: string;
  facility_type: FacilityType;
  municipality_code: string;
  municipality_name: string | null;
  barangay_code: string | null;
  barangay_name: string | null;
  address_line: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  licences: FacilityLicence[];
  hours: FacilityHours;
  verification_status: VerificationStatus;
  last_verified_at: string | null;
  price_item_count: number;
  last_stock_report_at: string | null;
};

export type LocationOption = { psgc_code: string; name: string };

export type PractitionerRow = {
  id: string;
  full_name: string;
  prc_number: string | null;
  prc_licence_expires_on: string | null;
  specialties: string[];
  prc_verified_at: string | null;
  prc_verified_by: string | null;
  is_live: boolean;
};

export type ServiceRow = {
  id: string;
  service_type: ServiceType;
  name: string;
  description: string | null;
};

export type PriceRow = {
  id: string;
  amount_min_centavos: number;
  amount_max_centavos: number;
  source: PriceSource;
  observed_at: string;
  report_count: number | null;
  service: { name: string; service_type: ServiceType } | null;
};

export type CoverageProgramRow = {
  id: string;
  program_type: CoverageProgramType;
  code: string;
  name: string;
  rules_version: string;
  source_url: string;
  last_reviewed_on: string | null;
};

export type AccreditationRow = {
  id: string;
  valid_from: string;
  valid_to: string | null;
  source: string;
  source_url: string | null;
  coverage_program: { name: string; program_type: CoverageProgramType } | null;
};

export type AccountRow = {
  id: string;
  role: AppRole | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
};

export type AccessLogRow = {
  id: string;
  actor_id: string | null;
  subject_patient_id: string | null;
  action: string;
  resource_type: string | null;
  at: string;
};
