import { notFound } from "next/navigation";
import { idSchema, type FacilityHours, type FacilityType, type VerificationStatus } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSection, segmentOf, type Section, type Segment } from "./segments";

export const PROVIDER_HOME = "/partner/provider";

export const facilityPath = (facilityId: string, section?: string) =>
  section ? `${PROVIDER_HOME}/${facilityId}/${section}` : `${PROVIDER_HOME}/${facilityId}`;

export type ProviderFacility = {
  id: string;
  name: string;
  facility_type: FacilityType;
  parent_org_id: string | null;
  municipality_code: string;
  address_line: string | null;
  phone: string | null;
  hours: FacilityHours;
  verification_status: VerificationStatus;
  last_verified_at: string | null;
};

export const FACILITY_COLUMNS =
  "id, name, facility_type, parent_org_id, municipality_code, address_line, phone, hours, verification_status, last_verified_at";

/** The signed-in provider-staff account and its RLS-scoped client. */
export async function providerContext() {
  const session = await requireRole(["provider_staff"]);
  const supabase = await createClient();
  return { supabase, actorId: session.userId };
}

/**
 * One facility, as its staff. A facility the caller's organization does not
 * own is simply not found. When `section` is given, the facility's portal
 * must contain that section.
 */
export async function facilityContext(facilityId: unknown, section?: Section) {
  const { supabase, actorId } = await providerContext();
  const id = idSchema.safeParse(facilityId);
  if (!id.success) notFound();

  // Being able to read a facility is not enough: verified listings are readable
  // by every signed-in account. The portal opens only for staff of the
  // organization that owns it, which is what can_manage_facility() answers.
  const [{ data }, { data: manages }] = await Promise.all([
    supabase.from("facility").select(FACILITY_COLUMNS).eq("id", id.data).maybeSingle(),
    supabase.rpc("can_manage_facility", { p_facility_id: id.data }),
  ]);
  if (!data || manages !== true) notFound();
  const facility = data as ProviderFacility;
  const segment = segmentOf(facility.facility_type);
  if (!segment || (section && !hasSection(segment, section))) notFound();

  return { supabase, actorId, facility, segment: segment as Segment };
}
