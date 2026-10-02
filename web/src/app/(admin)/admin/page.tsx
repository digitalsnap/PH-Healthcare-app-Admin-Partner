import { getTranslations } from "next-intl/server";

export default async function AdminHomePage() {
  const t = await getTranslations("console.admin");

  return <p className="text-sm text-zinc-600">{t("placeholder")}</p>;
}
