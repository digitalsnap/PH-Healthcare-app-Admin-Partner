"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAccess } from "../audit";
import { adminContext } from "../context";
import { failed, SAVED, type FormState } from "../form-state";
import { parseAccountForm, parseInviteForm } from "../schemas";

/** Only admins manage accounts; field staff cannot. */
const ADMIN_ONLY = ["admin"] as const;

/**
 * Invites a member of the team. The auth account is created with the service
 * role (the only thing that can), but the role itself is written through the
 * admin's own client, so row-level security still decides who may assign it.
 */
export async function inviteUser(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext(ADMIN_ONLY);
  const parsed = parseInviteForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await createAdminClient().auth.admin.inviteUserByEmail(parsed.data.email);
  if (error || !data.user) return failed("inviteFailed");

  const { error: insertError } = await supabase.from("app_user").insert({
    id: data.user.id,
    role: parsed.data.role,
    display_name: parsed.data.display_name,
  });
  if (insertError) return failed("inviteFailed");

  await logAccess(supabase, actorId, {
    action: "app_user.invite",
    resourceType: "app_user",
    resourceId: data.user.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

export async function updateAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext(ADMIN_ONLY);
  const parsed = parseAccountForm(formData);
  if (!parsed.ok) return parsed.state;

  // An admin cannot demote or deactivate themselves and lock the team out.
  if (parsed.data.id === actorId) return failed("cannotChangeOwnAccount");

  const { error } = await supabase
    .from("app_user")
    .update({ role: parsed.data.role ?? null, is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) return failed("generic");

  await logAccess(supabase, actorId, {
    action: "app_user.update_role",
    resourceType: "app_user",
    resourceId: parsed.data.id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}
