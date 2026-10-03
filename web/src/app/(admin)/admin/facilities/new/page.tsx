import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { FacilityFields } from "@/components/admin/facility-fields";
import { PageHeader } from "@/components/admin/fields";
import { createFacility } from "@/lib/admin/actions/facilities";
import { adminContext } from "@/lib/admin/context";
import type { LocationOption, OrganizationOption } from "@/lib/admin/types";

export default async function NewFacilityPage() {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const { data } = await supabase
    .from("location")
    .select("psgc_code, name")
    .eq("level", "municipality")
    .order("name");

  const { data: organizations } = await supabase.from("organization").select("id, name").order("name").limit(500);

  return (
    <>
      <PageHeader title={t("facilities.new")} />
      <ActionForm action={createFacility} submitLabel={t("common.save")}>
        <FacilityFields
          municipalities={(data ?? []) as LocationOption[]}
          organizations={(organizations ?? []) as OrganizationOption[]}
        />
      </ActionForm>
    </>
  );
}
