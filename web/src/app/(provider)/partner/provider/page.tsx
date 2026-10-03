import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Empty, LIST, PageHeader, ROW_LINK } from "@/components/admin/fields";
import { FACILITY_COLUMNS, facilityPath, providerContext, type ProviderFacility } from "@/lib/provider/context";
import { segmentOf } from "@/lib/provider/segments";

const FACILITY_LIMIT = 200;

// Every facility the signed-in staff member's organization owns. Row-level
// security decides the list; choosing one opens that facility's portal.
export default async function ProviderHomePage() {
  const { supabase } = await providerContext();
  const t = await getTranslations("provider");
  const types = await getTranslations("admin.facilityTypes");

  const { data } = await supabase
    .from("facility")
    .select(FACILITY_COLUMNS)
    .not("parent_org_id", "is", null)
    .order("name")
    .order("id")
    .limit(FACILITY_LIMIT);
  // Verified listings are readable by every signed-in account; only the ones
  // with a portal for this organization are offered here.
  const { data: memberships } = await supabase.from("organization_staff").select("organization_id");
  const organizations = new Set(((memberships ?? []) as { organization_id: string }[]).map((row) => row.organization_id));
  const facilities = ((data ?? []) as ProviderFacility[]).filter(
    (facility) => facility.parent_org_id !== null && organizations.has(facility.parent_org_id),
  );

  return (
    <>
      <PageHeader title={t("home.title")} />
      {facilities.length === 0 ? (
        <Empty>{t("home.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {facilities.map((facility) => {
            const segment = segmentOf(facility.facility_type);
            return (
              <li key={facility.id}>
                {segment ? (
                  <Link href={facilityPath(facility.id)} className={ROW_LINK}>
                    <span className="font-medium">{facility.name}</span>
                    <span className="text-sm text-zinc-600">
                      {types(facility.facility_type)} · {t(`segments.${segment}`)}
                    </span>
                  </Link>
                ) : (
                  <div className="flex flex-col gap-1 px-3 py-3">
                    <span className="font-medium">{facility.name}</span>
                    <span className="text-sm text-zinc-600">
                      {types(facility.facility_type)} · {t("home.noPortal")}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
