"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "../audit";
import { adminContext } from "../context";
import { failed, isUniqueViolation, SAVED, type FormState } from "../form-state";
import { idSchema, parseCoverageProgramForm, parseServiceForm } from "../schemas";

export async function createService(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parseServiceForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("service")
    .insert({ ...parsed.data, description: parsed.data.description ?? null })
    .select("id")
    .single();
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "service.create",
    resourceType: "service",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function createCoverageProgram(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parseCoverageProgramForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("coverage_program")
    .insert({ ...parsed.data, last_reviewed_on: parsed.data.last_reviewed_on ?? null })
    .select("id")
    .single();
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "coverage_program.create",
    resourceType: "coverage_program",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function updateCoverageProgram(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  const parsed = parseCoverageProgramForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase
    .from("coverage_program")
    .update({ ...parsed.data, last_reviewed_on: parsed.data.last_reviewed_on ?? null })
    .eq("id", id.data);
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "coverage_program.update",
    resourceType: "coverage_program",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  redirect("/admin/coverage");
}

export async function createOrganization(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const name = String(formData.get("name") ?? "").trim();
  if (name === "" || name.length > 200) return failed("nameRequired");

  const { data, error } = await supabase.from("organization").insert({ name }).select("id").single();
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "organization.create",
    resourceType: "organization",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

/**
 * Assigns a provider-staff account to an organization. They can then manage
 * every facility under it in the provider portal.
 */
export async function addOrganizationStaff(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const organizationId = idSchema.safeParse(formData.get("organization_id"));
  const accountId = idSchema.safeParse(formData.get("app_user_id"));
  if (!organizationId.success || !accountId.success) return failed("invalidChoice");

  const { data: account } = await supabase
    .from("app_user")
    .select("id")
    .eq("id", accountId.data)
    .eq("role", "provider_staff")
    .maybeSingle();
  if (!account) return failed("invalidChoice");

  const { error } = await supabase
    .from("organization_staff")
    .insert({ organization_id: organizationId.data, app_user_id: accountId.data });
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "organization_staff.add",
    resourceType: "organization",
    resourceId: organizationId.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function removeOrganizationStaff(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase.from("organization_staff").delete().eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "organization_staff.remove",
    resourceType: "organization_staff",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}
