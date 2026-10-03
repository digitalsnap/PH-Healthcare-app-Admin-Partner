import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Field, Input, PageHeader } from "@/components/admin/fields";
import { createPractitioner } from "@/lib/admin/actions/practitioners";
import { adminContext } from "@/lib/admin/context";

export default async function NewPractitionerPage() {
  await adminContext();
  const t = await getTranslations("admin");

  return (
    <>
      <PageHeader title={t("practitioners.new")} />
      <ActionForm action={createPractitioner} submitLabel={t("common.save")}>
        <Field label={t("practitioners.fullName")}>
          <Input name="full_name" required maxLength={200} />
        </Field>
        <Field label={t("practitioners.specialties")} hint={t("practitioners.specialtiesHint")}>
          <Input name="specialties" maxLength={500} />
        </Field>
        <Field label={t("practitioners.prcNumber")} hint={t("practitioners.prcNumberOptional")}>
          <Input name="prc_number" maxLength={20} />
        </Field>
      </ActionForm>
    </>
  );
}
