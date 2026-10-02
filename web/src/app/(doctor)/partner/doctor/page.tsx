import { getTranslations } from "next-intl/server";

export default async function DoctorHomePage() {
  const t = await getTranslations("console.doctor");

  return <p className="text-sm text-zinc-600">{t("placeholder")}</p>;
}
