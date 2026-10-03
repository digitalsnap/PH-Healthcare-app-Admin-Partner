import { getTranslations } from "next-intl/server";
import { ConsoleShell, type NavItem } from "@/components/console-shell";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["admin", "staff"]);
  const t = await getTranslations("console.admin");
  const nav = await getTranslations("admin.nav");

  const items: NavItem[] = [
    { href: "/admin", label: nav("dashboard") },
    { href: "/admin/facilities", label: nav("facilities") },
    { href: "/admin/practitioners", label: nav("practitioners") },
    { href: "/admin/services", label: nav("services") },
    { href: "/admin/coverage", label: nav("coverage") },
  ];
  // Accounts and the access log are for admins only.
  if (session.role === "admin") {
    items.push(
      { href: "/admin/users", label: nav("users") },
      { href: "/admin/access-log", label: nav("accessLog") },
    );
  }

  return (
    <ConsoleShell title={t("title")} nav={items}>
      {children}
    </ConsoleShell>
  );
}
