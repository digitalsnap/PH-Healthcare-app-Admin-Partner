import { getTranslations } from "next-intl/server";
import { ConsoleShell } from "@/components/console-shell";
import { requireRole } from "@/lib/auth/session";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["provider_staff"]);
  const t = await getTranslations("console.provider");

  return <ConsoleShell title={t("title")}>{children}</ConsoleShell>;
}
