import { NextResponse } from "next/server";
import { logAccess } from "@/lib/admin/audit";
import { idSchema } from "@/lib/admin/schemas";
import { facilityContext } from "@/lib/provider/context";
import { VAULT_BUCKET } from "@/lib/provider/schemas";

/** Long enough to open the file, short enough that a copied link is useless. */
const SIGNED_URL_SECONDS = 60;

/**
 * Hands the caller a short-lived signed URL for one vault file. The URL of
 * this route carries only the document's id; the file itself is never public
 * and every open is written to the access log.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/partner/provider/[facilityId]/results/[documentId]/file">,
) {
  const { facilityId, documentId } = await params;
  const { supabase, actorId, facility } = await facilityContext(facilityId, "results");
  const id = idSchema.safeParse(documentId);
  if (!id.success) return new NextResponse(null, { status: 404 });

  // Row-level security: only a document this facility delivered is visible.
  const { data: document } = await supabase
    .from("vault_document")
    .select("id, storage_path, patient_id, withdrawal_status")
    .eq("id", id.data)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!document) return new NextResponse(null, { status: 404 });
  // An approved withdrawal means the file is gone, or about to be.
  if (document.withdrawal_status === "approved") return new NextResponse(null, { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(document.storage_path as string, SIGNED_URL_SECONDS);
  if (error || !signed) return new NextResponse(null, { status: 502 });

  await logAccess(supabase, actorId, {
    action: "vault_document.read",
    resourceType: "vault_document",
    resourceId: document.id as string,
    subjectPatientId: document.patient_id as string,
  });

  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
