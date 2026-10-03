import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { facilityContext, facilityPath, PROVIDER_HOME } from "@/lib/provider/context";
import { sectionsOf } from "@/lib/provider/segments";

// One facility's portal. The menu is the portal: a clinic, a diagnostics
// branch and a pharmacy each get only their own sections.
export default async function FacilityLayout({
  children,
  params,
}: LayoutProps<"/partner/provider/[facilityId]">) {
  const { facility, segment } = await facilityContext((await params).facilityId);
  const t = await getTranslations("provider");

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={PROVIDER_HOME} className="text-sm underline">
          {t("nav.allFacilities")}
        </Link>
        <span className="text-sm font-semibold">
          {facility.name} · {t(`segments.${segment}`)}
        </span>
        <nav className="-mx-2 flex gap-1 overflow-x-auto text-sm">
          <Link href={facilityPath(facility.id)} className="flex min-h-11 shrink-0 items-center rounded px-3 hover:bg-zinc-100">
            {t("nav.overview")}
          </Link>
          {sectionsOf(segment).map((section) => (
            <Link
              key={section}
              href={facilityPath(facility.id, section)}
              className="flex min-h-11 shrink-0 items-center rounded px-3 hover:bg-zinc-100"
            >
              {t(`nav.${section}`)}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}
