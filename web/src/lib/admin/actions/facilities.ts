"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "../audit";
import { adminContext } from "../context";
import { failed, isUniqueViolation, SAVED, type FormState } from "../form-state";
import {
  idSchema,
  parseAccreditationForm,
  parseFacilityForm,
  parseFacilityStatusForm,
  parsePriceForm,
  type FacilityInput,
} from "../schemas";

type Supabase = Awaited<ReturnType<typeof adminContext>>["supabase"];

const facilityPath = (id: string) => `/admin/facilities/${id}`;

/**
 * Region and province are never typed by hand: they are read from the chosen
 * municipality's PSGC row, and a barangay must belong to that municipality.
 */
async function resolveLocation(supabase: Supabase, input: FacilityInput) {
  const { data: municipality } = await supabase
    .from("location")
    .select("region_code, province_code")
    .eq("psgc_code", input.municipality_code)
    .eq("level", "municipality")
    .maybeSingle();
  if (!municipality) return null;

  if (input.barangay_code) {
    const { data: barangay } = await supabase
      .from("location")
      .select("psgc_code")
      .eq("psgc_code", input.barangay_code)
      .eq("level", "barangay")
      .eq("municipality_code", input.municipality_code)
      .maybeSingle();
    if (!barangay) return null;
  }

  return {
    region_code: municipality.region_code as string,
    province_code: municipality.province_code as string | null,
  };
}

export async function createFacility(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parseFacilityForm(formData);
  if (!parsed.ok) return parsed.state;

  const location = await resolveLocation(supabase, parsed.data);
  if (!location) return failed("invalidChoice");

  const { data, error } = await supabase
    .from("facility")
    .insert({ ...parsed.data, ...location })
    .select("id")
    .single();
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "facility.create",
    resourceType: "facility",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  redirect(facilityPath(data.id));
}

export async function updateFacility(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  const parsed = parseFacilityForm(formData);
  if (!parsed.ok) return parsed.state;

  const location = await resolveLocation(supabase, parsed.data);
  if (!location) return failed("invalidChoice");

  const { error } = await supabase
    .from("facility")
    .update({ ...parsed.data, ...location })
    .eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "facility.update",
    resourceType: "facility",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  redirect(facilityPath(id.data));
}

/** Records that someone checked this listing now. Sets status, date and verifier together. */
export async function recordFacilityVerification(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase
    .from("facility")
    .update({
      verification_status: "verified",
      last_verified_at: new Date().toISOString(),
      last_verified_by: actorId,
    })
    .eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "facility.verify",
    resourceType: "facility",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function setFacilityStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parseFacilityStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase
    .from("facility")
    .update({ verification_status: parsed.data.verification_status })
    .eq("id", parsed.data.id);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "facility.set_status",
    resourceType: "facility",
    resourceId: parsed.data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function addPrice(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parsePriceForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("price_item")
    .insert({
      ...parsed.data,
      // A facility-confirmed price counts as verified on the day it was confirmed.
      last_verified_at: parsed.data.source === "facility_confirmed" ? parsed.data.observed_at : null,
    })
    .select("id")
    .single();
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "price_item.create",
    resourceType: "price_item",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function deletePrice(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase.from("price_item").delete().eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "price_item.delete",
    resourceType: "price_item",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function addAccreditation(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parseAccreditationForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("accreditation")
    .insert({
      ...parsed.data,
      valid_to: parsed.data.valid_to ?? null,
      source_url: parsed.data.source_url ?? null,
    })
    .select("id")
    .single();
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "accreditation.create",
    resourceType: "accreditation",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function deleteAccreditation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase.from("accreditation").delete().eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "accreditation.delete",
    resourceType: "accreditation",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}
