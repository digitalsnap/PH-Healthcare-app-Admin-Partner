"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logAccess } from "@/lib/admin/audit";
import { failed, SAVED, type FormState } from "@/lib/admin/form-state";
import { facilityContext, PROVIDER_HOME } from "../context";
import { parseResultForm, parseWithdrawalForm, VAULT_BUCKET, type ResultMimeType } from "../schemas";

/** The first bytes every file of a type starts with. */
const SIGNATURES: Record<ResultMimeType, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

/** The browser's stated type is only a claim; the content has to agree. */
function looksLike(bytes: Uint8Array, mimeType: ResultMimeType): boolean {
  return SIGNATURES[mimeType].every((byte, index) => bytes[index] === byte);
}

/**
 * Delivers a result file to the patient's vault. The platform stores and hands
 * over the document; it never reads or interprets it.
 *
 * The file goes to the private bucket under '<facility>/<document id>' — no
 * patient identifier in the path — through the staff member's own session, so
 * the storage policies apply. The vault_document row is what releases it to
 * the patient; if that row cannot be written, the file is removed again.
 */
export async function deliverResult(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "results");
  const parsed = parseResultForm(formData);
  if (!parsed.ok) return parsed.state;
  const { file, mime_type: mimeType, appointment_id: appointmentId, document_type: documentType } = parsed.data;

  // The appointment must be at this facility; its patient is who receives the file.
  const { data: appointment } = await supabase
    .from("appointment")
    .select("id, patient_id")
    .eq("id", appointmentId)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!appointment) return failed("generic");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLike(bytes, mimeType)) return failed("fileTypeNotAllowed");

  const documentId = randomUUID();
  const path = `${facility.id}/${documentId}`;
  const storage = supabase.storage.from(VAULT_BUCKET);

  const upload = await storage.upload(path, bytes, { contentType: mimeType, upsert: false });
  if (upload.error) return failed("uploadFailed");

  const { error } = await supabase.from("vault_document").insert({
    id: documentId,
    patient_id: appointment.patient_id,
    document_type: documentType,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    appointment_id: appointment.id,
    facility_id: facility.id,
    uploaded_by: actorId,
  });
  if (error) {
    await storage.remove([path]);
    return failed("uploadFailed");
  }

  await logAccess(supabase, actorId, {
    action: "vault_document.release",
    resourceType: "vault_document",
    resourceId: documentId,
    subjectPatientId: appointment.patient_id as string,
  });
  revalidatePath(PROVIDER_HOME, "layout");
  return SAVED;
}

/**
 * Asks for a wrongly delivered result to be withdrawn. The patient stops
 * seeing the document at once; the internal team then approves (the file is
 * deleted) or rejects (the patient sees it again). Staff cannot approve their
 * own request — the database refuses it.
 */
export async function requestWithdrawal(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "results");
  const parsed = parseWithdrawalForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data: document } = await supabase
    .from("vault_document")
    .select("id, patient_id, withdrawal_status")
    .eq("id", parsed.data.id)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!document) return failed("generic");
  if (document.withdrawal_status !== null) return failed("withdrawalNotAllowed");

  const { error } = await supabase
    .from("vault_document")
    .update({
      withdrawal_status: "requested",
      withdrawal_reason: parsed.data.withdrawal_reason,
      withdrawal_requested_at: new Date().toISOString(),
      withdrawal_requested_by: actorId,
    })
    .eq("id", document.id);
  if (error) return failed("withdrawalNotAllowed");

  await logAccess(supabase, actorId, {
    action: "vault_document.request_withdrawal",
    resourceType: "vault_document",
    resourceId: document.id as string,
    subjectPatientId: document.patient_id as string,
  });
  revalidatePath(PROVIDER_HOME, "layout");
  revalidatePath("/admin", "layout");
  return SAVED;
}
