"use server";

import { revalidatePath } from "next/cache";
import { VAULT_BUCKET } from "@/lib/provider/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAccess } from "../audit";
import { adminContext } from "../context";
import { failed, SAVED, type FormState } from "../form-state";
import { idSchema } from "../schemas";

type Supabase = Awaited<ReturnType<typeof adminContext>>["supabase"];

/**
 * Withdrawing a wrongly delivered result.
 *
 * A facility requests it (the patient stops seeing the document at once); the
 * internal team decides here. The console never shows the document or the
 * patient's name — only what is needed to decide.
 *
 * What protects the patient is the approval itself: from that moment the
 * document is hidden for good, whatever happens to the stored file. Deleting
 * the file is a second step, and it can fail (storage unreachable, a timeout).
 * When it does, the withdrawal stays in the queue as "approved, file not
 * confirmed deleted" until a retry succeeds or an admin closes it by hand.
 */

/**
 * Deletes the stored file and then checks that it is really gone, rather than
 * trusting the delete call's answer. Uses the service role because the
 * internal team has, deliberately, no storage access of its own. Safe to run
 * again: a file that is already gone counts as removed.
 */
async function fileIsGone(storagePath: string): Promise<boolean> {
  const storage = createAdminClient().storage.from(VAULT_BUCKET);

  const removal = await storage.remove([storagePath]);
  if (removal.error) return false;

  // '<facility>/<document>': list the facility folder for this one name.
  const [folder, name] = storagePath.split("/");
  const listing = await storage.list(folder, { search: name, limit: 1 });
  if (listing.error) return false;
  return !(listing.data ?? []).some((object) => object.name === name);
}

async function recordFileRemoved(supabase: Supabase, documentId: string, overrideBy: string | null): Promise<boolean> {
  const { error } = await supabase
    .from("vault_document")
    .update({ file_removed_at: new Date().toISOString(), file_removal_override_by: overrideBy })
    .eq("id", documentId);
  return !error;
}

/** An approved withdrawal whose file is not yet recorded as removed. */
async function pendingRemoval(supabase: Supabase, id: string) {
  const { data } = await supabase
    .from("vault_document")
    .select("id, storage_path, patient_id, withdrawal_status, file_removed_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.withdrawal_status !== "approved" || data.file_removed_at !== null) return null;
  return data as { id: string; storage_path: string; patient_id: string };
}

/**
 * Approves or rejects a facility's request. Approving hides the document for
 * good and deletes the file; rejecting makes it visible to the patient again.
 */
export async function decideWithdrawal(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  const decision = formData.get("decision");
  if (!id.success || (decision !== "approved" && decision !== "rejected")) return failed("generic");

  const { data: document } = await supabase
    .from("vault_document")
    .select("id, storage_path, patient_id, withdrawal_status")
    .eq("id", id.data)
    .maybeSingle();
  if (!document || document.withdrawal_status !== "requested") return failed("withdrawalNotAllowed");

  const { error } = await supabase
    .from("vault_document")
    .update({
      withdrawal_status: decision,
      withdrawal_decided_at: new Date().toISOString(),
      withdrawal_decided_by: actorId,
    })
    .eq("id", document.id);
  if (error) return failed("withdrawalNotAllowed");

  await logAccess(supabase, actorId, {
    action: `vault_document.withdrawal_${decision}`,
    resourceType: "vault_document",
    resourceId: document.id as string,
    subjectPatientId: document.patient_id as string,
  });
  revalidatePath("/admin", "layout");
  if (decision === "rejected") return SAVED;

  // The decision stands even if this part fails; the queue then offers a retry.
  if (!(await fileIsGone(document.storage_path as string))) return failed("fileRemovalFailed");
  if (!(await recordFileRemoved(supabase, document.id as string, null))) return failed("fileRemovalFailed");
  revalidatePath("/admin", "layout");
  return SAVED;
}

/** Tries again to delete the file of an approved withdrawal. */
export async function retryFileRemoval(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const document = await pendingRemoval(supabase, id.data);
  if (!document) return failed("withdrawalNotAllowed");

  if (!(await fileIsGone(document.storage_path))) return failed("fileRemovalFailed");
  if (!(await recordFileRemoved(supabase, document.id, null))) return failed("fileRemovalFailed");

  await logAccess(supabase, actorId, {
    action: "vault_document.file_removed",
    resourceType: "vault_document",
    resourceId: document.id,
    subjectPatientId: document.patient_id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}

/**
 * The admin's override: closes an approved withdrawal by hand when storage
 * will not confirm the deletion — for example after removing the file
 * directly in the storage console. Admins only (not field staff), needs an
 * explicit confirmation, and is recorded under the admin's own name. One last
 * deletion is attempted first, so an override never skips a delete that
 * would have worked.
 */
export async function overrideFileRemoval(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId } = await adminContext(["admin"]);
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  if (formData.get("confirm") !== "on") return failed("overrideNotConfirmed");

  const document = await pendingRemoval(supabase, id.data);
  if (!document) return failed("withdrawalNotAllowed");

  const confirmedGone = await fileIsGone(document.storage_path);
  if (!(await recordFileRemoved(supabase, document.id, confirmedGone ? null : actorId))) {
    return failed("withdrawalNotAllowed");
  }

  await logAccess(supabase, actorId, {
    action: confirmedGone ? "vault_document.file_removed" : "vault_document.file_removal_overridden",
    resourceType: "vault_document",
    resourceId: document.id,
    subjectPatientId: document.patient_id,
  });
  revalidatePath("/admin", "layout");
  return SAVED;
}
