import { getTranslations } from "next-intl/server";
import { ConsoleShell } from "@/components/console-shell";
import { requireRole } from "@/lib/auth/session";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["doctor"]);
  const t = await getTranslations("console.doctor");

  return <ConsoleShell title={t("title")}>{children}</ConsoleShell>;
}
