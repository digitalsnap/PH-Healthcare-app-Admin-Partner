"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAccess } from "../audit";
import { adminContext } from "../context";
import { failed, isUniqueViolation, SAVED, type FormState } from "../form-state";
import { idSchema, parsePractitionerForm, parsePrcVerificationForm } from "../schemas";

const practitionerPath = (id: string) => `/admin/practitioners/${id}`;

export async function createPractitioner(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parsePractitionerForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("practitioner")
    .insert({
      full_name: parsed.data.full_name,
      specialties: parsed.data.specialties,
      prc_number: parsed.data.prc_number ?? null,
    })
    .select("id")
    .single();
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error || !data) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "practitioner.create",
    resourceType: "practitioner",
    resourceId: data.id,
  });
  revalidatePath("/admin", "layout");
  redirect(practitionerPath(data.id));
}

/**
 * Records PRC verification. All of it is written in one update: the PRC
 * number and licence expiry from the form, and who verified and when from the
 * server. The database rejects a verification with any of them missing.
 */
export async function verifyPrc(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const parsed = parsePrcVerificationForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase
    .from("practitioner")
    .update({
      prc_number: parsed.data.prc_number,
      prc_licence_expires_on: parsed.data.prc_licence_expires_on,
      prc_verified_at: new Date().toISOString(),
      prc_verified_by: actorId,
    })
    .eq("id", parsed.data.id);
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "practitioner.verify_prc",
    resourceType: "practitioner",
    resourceId: parsed.data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

/** Withdraws verification; the profile comes off live in the same update. */
export async function revokePrc(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { error } = await supabase
    .from("practitioner")
    .update({ prc_verified_at: null, prc_verified_by: null, is_live: false })
    .eq("id", id.data);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "practitioner.revoke_prc",
    resourceType: "practitioner",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function setPractitionerLive(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  const live = formData.get("is_live") === "true";

  if (live) {
    const { data } = await supabase
      .from("practitioner")
      .select("prc_verified_at")
      .eq("id", id.data)
      .maybeSingle();
    if (!data?.prc_verified_at) return failed("prcNotVerified");
  }

  // The database also refuses is_live without PRC verification.
  const { error } = await supabase.from("practitioner").update({ is_live: live }).eq("id", id.data);
  if (error) return failed(live ? "prcNotVerified" : "generic");

  await logAccess(supabase, actorId, {
    action: live ? "practitioner.go_live" : "practitioner.take_offline",
    resourceType: "practitioner",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

/**
 * Links a practitioner profile to the doctor's login, so that account can
 * manage this profile's schedule. Only accounts with the doctor role qualify.
 */
export async function linkPractitionerAccount(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  const rawAccount = formData.get("app_user_id");
  const account = rawAccount ? idSchema.safeParse(rawAccount) : null;
  if (account && !account.success) return failed("invalidChoice");

  if (account) {
    const { data } = await supabase
      .from("app_user")
      .select("id")
      .eq("id", account.data)
      .eq("role", "doctor")
      .maybeSingle();
    if (!data) return failed("invalidChoice");
  }

  const { error } = await supabase
    .from("practitioner")
    .update({ app_user_id: account ? account.data : null })
    .eq("id", id.data);
  if (isUniqueViolation(error)) return failed("duplicate");
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "practitioner.link_account",
    resourceType: "practitioner",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

/** Approves or rejects a doctor's request to be affiliated with a facility. */
export async function decideAffiliation(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  const decision = formData.get("decision");
  if (!id.success || (decision !== "approved" && decision !== "rejected")) return failed("generic");

  const { error } = await supabase
    .from("practitioner_facility")
    .update({ status: decision, decided_at: new Date().toISOString(), decided_by: actorId })
    .eq("id", id.data)
    .eq("status", "pending");
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: `practitioner_facility.${decision}`,
    resourceType: "practitioner_facility",
    resourceId: id.data,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}
