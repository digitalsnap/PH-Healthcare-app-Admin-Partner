import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Empty, LIST, PageHeader, ROW_LINK, Section } from "@/components/admin/fields";
import { FreshnessBadge } from "@/components/admin/freshness-badge";
import { adminContext } from "@/lib/admin/context";
import {
  daysAgoIso,
  percentOf,
  RED_AFTER_DAYS,
  STOCK_REPORT_MAX_AGE_DAYS,
} from "@/lib/admin/freshness";
import type { FacilityRow, PractitionerRow } from "@/lib/admin/types";

const QUEUE_SIZE = 10;

function Tile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded border border-zinc-200 p-4 hover:bg-zinc-50">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-sm text-zinc-600">{label}</span>
    </Link>
  );
}

// Data freshness dashboard: the console's landing page.
export default async function AdminDashboardPage() {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const now = new Date();
  const counted = { count: "exact", head: true } as const;
  const stockCutoff = daysAgoIso(STOCK_REPORT_MAX_AGE_DAYS, now);

  const [total, verified, noPrices, staleStock, unverifiedDoctors, queue, awaitingPrc] =
    await Promise.all([
      supabase.from("facility_admin_view").select("id", counted),
      supabase
        .from("facility_admin_view")
        .select("id", counted)
        .gte("last_verified_at", daysAgoIso(RED_AFTER_DAYS, now)),
      supabase.from("facility_admin_view").select("id", counted).eq("price_item_count", 0),
      supabase
        .from("facility_admin_view")
        .select("id", counted)
        .eq("facility_type", "pharmacy")
        .or(`last_stock_report_at.is.null,last_stock_report_at.lt.${stockCutoff}`),
      supabase.from("practitioner").select("id", counted).is("prc_verified_at", null),
      // What to verify next: never-verified first, then the oldest.
      supabase
        .from("facility_admin_view")
        .select("id, name, facility_type, municipality_name, last_verified_at")
        .order("last_verified_at", { ascending: true, nullsFirst: true })
        .limit(QUEUE_SIZE),
      supabase
        .from("practitioner")
        .select("id, full_name, prc_number")
        .is("prc_verified_at", null)
        .order("created_at", { ascending: true })
        .limit(QUEUE_SIZE),
    ]);

  const totalCount = total.count ?? 0;
  const verifiedCount = verified.count ?? 0;
  const queueRows = (queue.data ?? []) as Pick<
    FacilityRow,
    "id" | "name" | "facility_type" | "municipality_name" | "last_verified_at"
  >[];
  const prcRows = (awaitingPrc.data ?? []) as Pick<PractitionerRow, "id" | "full_name" | "prc_number">[];

  return (
    <>
      <PageHeader title={t("dashboard.title")} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile
          href="/admin/facilities"
          value={`${percentOf(verifiedCount, totalCount)}%`}
          label={t("dashboard.verifiedShare", { verified: verifiedCount, total: totalCount })}
        />
        <Tile
          href="/admin/facilities?missing=prices"
          value={String(noPrices.count ?? 0)}
          label={t("dashboard.noPrices")}
        />
        <Tile
          href="/admin/facilities?missing=stock"
          value={String(staleStock.count ?? 0)}
          label={t("dashboard.staleStock")}
        />
        <Tile
          href="/admin/practitioners?prc=unverified"
          value={String(unverifiedDoctors.count ?? 0)}
          label={t("dashboard.unverifiedDoctors")}
        />
      </div>

      <Section title={t("dashboard.workQueue")}>
        {queueRows.length === 0 ? (
          <Empty>{t("dashboard.workQueueEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {queueRows.map((facility) => (
              <li key={facility.id}>
                <Link href={`/admin/facilities/${facility.id}`} className={ROW_LINK}>
                  <span className="font-medium">{facility.name}</span>
                  <span className="text-sm text-zinc-600">
                    {t(`facilityTypes.${facility.facility_type}`)}
                    {facility.municipality_name ? ` · ${facility.municipality_name}` : ""}
                  </span>
                  <FreshnessBadge lastVerifiedAt={facility.last_verified_at} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("dashboard.awaitingPrc")}>
        {prcRows.length === 0 ? (
          <Empty>{t("dashboard.awaitingPrcEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {prcRows.map((practitioner) => (
              <li key={practitioner.id}>
                <Link href={`/admin/practitioners/${practitioner.id}`} className={ROW_LINK}>
                  <span className="font-medium">{practitioner.full_name}</span>
                  <span className="text-sm text-zinc-600">
                    {practitioner.prc_number ?? t("practitioners.noPrcNumber")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
