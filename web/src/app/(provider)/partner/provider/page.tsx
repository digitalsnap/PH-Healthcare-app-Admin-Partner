import { getTranslations } from "next-intl/server";

export default async function ProviderHomePage() {
  const t = await getTranslations("console.provider");

  return <p className="text-sm text-zinc-600">{t("placeholder")}</p>;
}
