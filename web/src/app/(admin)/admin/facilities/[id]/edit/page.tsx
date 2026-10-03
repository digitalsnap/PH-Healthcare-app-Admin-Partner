import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { FacilityFields } from "@/components/admin/facility-fields";
import { PageHeader } from "@/components/admin/fields";
import { updateFacility } from "@/lib/admin/actions/facilities";
import { adminContext } from "@/lib/admin/context";
import { idSchema } from "@/lib/admin/schemas";
import type { FacilityRow, LocationOption } from "@/lib/admin/types";

export default async function EditFacilityPage({ params }: PageProps<"/admin/facilities/[id]/edit">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data } = await supabase.from("facility_admin_view").select("*").eq("id", id.data).maybeSingle();
  if (!data) notFound();
  const facility = data as FacilityRow;

  const [{ data: municipalities }, { data: barangays }] = await Promise.all([
    supabase.from("location").select("psgc_code, name").eq("level", "municipality").order("name"),
    supabase
      .from("location")
      .select("psgc_code, name")
      .eq("level", "barangay")
      .eq("municipality_code", facility.municipality_code)
      .order("name"),
  ]);

  return (
    <>
      <PageHeader title={t("facilities.edit", { name: facility.name })} />
      <ActionForm action={updateFacility} submitLabel={t("common.save")}>
        <input type="hidden" name="id" value={facility.id} />
        <FacilityFields
          facility={facility}
          municipalities={(municipalities ?? []) as LocationOption[]}
          barangays={(barangays ?? []) as LocationOption[]}
        />
      </ActionForm>
    </>
  );
}
