import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/admin/fields";

// Shown to an account with the doctor role that no practitioner profile is
// linked to yet. The internal team links them from the admin console.
export default async function UnlinkedPage() {
  const t = await getTranslations("doctor.unlinked");

  return (
    <>
      <PageHeader title={t("title")} />
      <p className="text-sm text-zinc-600">{t("body")}</p>
    </>
  );
}
