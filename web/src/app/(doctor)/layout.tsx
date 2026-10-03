import { getTranslations } from "next-intl/server";
import { ConsoleShell, type NavItem } from "@/components/console-shell";
import { requireRole } from "@/lib/auth/session";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["doctor"]);
  const t = await getTranslations("console.doctor");
  const nav = await getTranslations("doctor.nav");

  const items: NavItem[] = [
    { href: "/partner/doctor", label: nav("today") },
    { href: "/partner/doctor/calendar", label: nav("calendar") },
    { href: "/partner/doctor/appointments", label: nav("appointments") },
    { href: "/partner/doctor/availability", label: nav("availability") },
    { href: "/partner/doctor/profile", label: nav("profile") },
  ];

  return (
    <ConsoleShell title={t("title")} nav={items}>
      {children}
    </ConsoleShell>
  );
}
