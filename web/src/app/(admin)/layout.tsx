import { getTranslations } from "next-intl/server";
import { ConsoleShell } from "@/components/console-shell";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["admin", "staff"]);
  const t = await getTranslations("console.admin");

  return <ConsoleShell title={t("title")}>{children}</ConsoleShell>;
}
