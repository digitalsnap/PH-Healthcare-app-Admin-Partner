"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "@/lib/admin/audit";
import { failed, isUniqueViolation, SAVED, type FormState } from "@/lib/admin/form-state";
import { idSchema } from "@/lib/admin/schemas";
import { parseExceptionForm, parseResourceRuleForm } from "@/lib/doctor/schemas";
import { syncSchedule } from "@/lib/doctor/slots";
import { manilaToday, utcIsoToManilaDate } from "@/lib/time/manila";
import { facilityContext, facilityPath, PROVIDER_HOME } from "../context";
import {
  parseCatalogueServiceForm,
  parsePrepForm,
  parseProfileForm,
  parseProviderPriceForm,
  parseResourceForm,
} from "../schemas";

function refresh() {
  revalidatePath(PROVIDER_HOME, "layout");
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Contact details and hours only; the database refuses anything else. */
export async function updateFacilityProfile(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "profile");
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase.from("facility").update(parsed.data).eq("id", facility.id);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "facility.update_profile",
    resourceType: "facility",
    resourceId: facility.id,
  });
  refresh();
  return SAVED;
}

// ---------------------------------------------------------------------------
// Catalogue: services, prices, preparation instructions
// ---------------------------------------------------------------------------

export async function addCatalogueService(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await facilityContext(formData.get("facility_id"), "catalogue");
  const parsed = parseCatalogueServiceForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase.from("service").insert(parsed.data);
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

/**
 * A price entered by the facility itself is, by definition, confirmed by the
 * facility today. Source, observed date and verified date are set here.
 */
export async function addProviderPrice(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "catalogue");
  const parsed = parseProviderPriceForm(formData);
  if (!parsed.ok) return parsed.state;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("price_item")
    .insert({
      ...parsed.data,
      facility_id: facility.id,
      source: "facility_confirmed",
      observed_at: now,
      last_verified_at: now,
    })
    .select("id")
    .single();
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "price_item.create",
    resourceType: "price_item",
    resourceId: data.id,
  });
  refresh();
  return SAVED;
}

export async function deleteProviderPrice(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "catalogue");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase.from("price_item").delete().eq("id", id.data).eq("facility_id", facility.id);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "price_item.delete",
    resourceType: "price_item",
    resourceId: id.data,
  });
  refresh();
  return SAVED;
}

/** One set of instructions per service and language; saving again replaces it. */
export async function savePrep(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "catalogue");
  const parsed = parsePrepForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase.from("service_prep").upsert(
    {
      service_id: parsed.data.service_id,
      facility_id: facility.id,
      locale: parsed.data.locale,
      instructions: parsed.data.instructions,
      fasting_hours: parsed.data.fasting_hours ?? null,
    },
    { onConflict: "service_id,facility_id,locale" },
  );
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

export async function deletePrep(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "catalogue");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase.from("service_prep").delete().eq("id", id.data).eq("facility_id", facility.id);
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

// ---------------------------------------------------------------------------
// Scheduling: resources, weekly sessions, exceptions, publish
// ---------------------------------------------------------------------------

export async function addResource(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "schedule");
  const parsed = parseResourceForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase
    .from("schedule")
    .insert({ facility_id: facility.id, facility_resource: parsed.data.facility_resource });
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

/** The schedule, only if it is a resource schedule of this facility. */
async function ownSchedule(
  supabase: Awaited<ReturnType<typeof facilityContext>>["supabase"],
  facilityId: string,
  scheduleId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("schedule")
    .select("id")
    .eq("id", scheduleId)
    .eq("facility_id", facilityId)
    .is("practitioner_id", null)
    .maybeSingle();
  return data !== null;
}

export async function addResourceRule(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "schedule");
  const parsed = parseResourceRuleForm(formData);
  if (!parsed.ok) return parsed.state;
  const { valid_to: validTo, ...rule } = parsed.data;
  if (!(await ownSchedule(supabase, facility.id, rule.schedule_id))) return failed("generic");

  const { error } = await supabase
    .from("availability_rule")
    .insert({ ...rule, valid_to: validTo ?? null, mode: "in_person" });
  if (error) return failed("generic");

  if (!(await syncSchedule(supabase, rule.schedule_id))) return failed("generic");
  refresh();
  redirect(facilityPath(facility.id, "schedule"));
}

export async function deleteResourceRule(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await facilityContext(formData.get("facility_id"), "schedule");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { data } = await supabase
    .from("availability_rule")
    .delete()
    .eq("id", id.data)
    .select("schedule_id")
    .maybeSingle();
  if (!data) return failed("generic");

  if (!(await syncSchedule(supabase, data.schedule_id as string))) return failed("generic");
  refresh();
  return SAVED;
}

export async function addResourceException(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "schedule");
  const parsed = parseExceptionForm(formData);
  if (!parsed.ok) return parsed.state;
  if (!(await ownSchedule(supabase, facility.id, parsed.data.schedule_id))) return failed("generic");
  // An exception that is already over would change nothing.
  if (utcIsoToManilaDate(parsed.data.ends_at) < manilaToday()) return failed("invalidDate");

  const { error } = await supabase.from("schedule_exception").insert(parsed.data);
  if (error) return failed("generic");

  if (!(await syncSchedule(supabase, parsed.data.schedule_id))) return failed("generic");
  refresh();
  return SAVED;
}

export async function deleteResourceException(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await facilityContext(formData.get("facility_id"), "schedule");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { data } = await supabase
    .from("schedule_exception")
    .delete()
    .eq("id", id.data)
    .select("schedule_id")
    .maybeSingle();
  if (!data) return failed("generic");

  if (!(await syncSchedule(supabase, data.schedule_id as string))) return failed("generic");
  refresh();
  return SAVED;
}

export async function setResourcePublished(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, facility } = await facilityContext(formData.get("facility_id"), "schedule");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  if (!(await ownSchedule(supabase, facility.id, id.data))) return failed("generic");

  const { error } = await supabase
    .from("schedule")
    .update({ is_published: formData.get("publish") === "true" })
    .eq("id", id.data);
  if (error) return failed("generic");

  if (!(await syncSchedule(supabase, id.data))) return failed("generic");
  refresh();
  return SAVED;
}
