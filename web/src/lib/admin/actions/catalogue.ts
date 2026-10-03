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
