import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Empty,
  Field,
  LINK_BUTTON,
  LIST,
  PageHeader,
  PRIMARY_LINK_BUTTON,
  ROW_LINK,
  Select,
} from "@/components/admin/fields";
import { FreshnessBadge } from "@/components/admin/freshness-badge";
import { Pagination } from "@/components/admin/pagination";
import { adminContext } from "@/lib/admin/context";
import {
  AMBER_AFTER_DAYS,
  daysAgoIso,
  RED_AFTER_DAYS,
  STOCK_REPORT_MAX_AGE_DAYS,
} from "@/lib/admin/freshness";
import { pageOf, param, rangeOf } from "@/lib/admin/pagination";
import { FACILITY_TYPES, VERIFICATION_STATUSES } from "@/lib/admin/schemas";
import type { FacilityRow, LocationOption } from "@/lib/admin/types";

const PATHNAME = "/admin/facilities";
const VERIFIED_BUCKETS = ["fresh", "amber", "red", "never"] as const;
const MISSING = ["prices", "stock"] as const;

function oneOf<T extends string>(options: readonly T[], value: string | undefined): T | undefined {
  return options.find((option) => option === value);
}

export default async function FacilitiesPage({ searchParams }: PageProps<"/admin/facilities">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const query = await searchParams;

  const type = oneOf(FACILITY_TYPES, param(query, "type"));
  const status = oneOf(VERIFICATION_STATUSES, param(query, "status"));
  const verified = oneOf(VERIFIED_BUCKETS, param(query, "verified"));
  const missing = oneOf(MISSING, param(query, "missing"));
  const municipality = /^[0-9]{10}$/.test(param(query, "municipality") ?? "")
    ? param(query, "municipality")
    : undefined;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const now = new Date();
  const amberCutoff = daysAgoIso(AMBER_AFTER_DAYS, now);
  const redCutoff = daysAgoIso(RED_AFTER_DAYS, now);

  let list = supabase
    .from("facility_admin_view")
    .select(
      "id, name, facility_type, municipality_name, verification_status, last_verified_at",
      { count: "exact" },
    );
  if (type) list = list.eq("facility_type", type);
  if (status) list = list.eq("verification_status", status);
  if (municipality) list = list.eq("municipality_code", municipality);
  if (verified === "fresh") list = list.gte("last_verified_at", amberCutoff);
  if (verified === "amber") list = list.lt("last_verified_at", amberCutoff).gte("last_verified_at", redCutoff);
  if (verified === "red") list = list.lt("last_verified_at", redCutoff);
  if (verified === "never") list = list.is("last_verified_at", null);
  if (missing === "prices") list = list.eq("price_item_count", 0);
  if (missing === "stock") {
    const cutoff = daysAgoIso(STOCK_REPORT_MAX_AGE_DAYS, now);
    list = list
      .eq("facility_type", "pharmacy")
      .or(`last_stock_report_at.is.null,last_stock_report_at.lt.${cutoff}`);
  }

  const [{ data, count }, { data: municipalities }] = await Promise.all([
    list.order("name").order("id").range(from, to),
    supabase.from("location").select("psgc_code, name").eq("level", "municipality").order("name"),
  ]);
  const rows = (data ?? []) as Pick<
    FacilityRow,
    "id" | "name" | "facility_type" | "municipality_name" | "verification_status" | "last_verified_at"
  >[];
  const municipalityOptions = (municipalities ?? []) as LocationOption[];

  return (
    <>
      <PageHeader
        title={t("facilities.title")}
        action={
          <Link href={`${PATHNAME}/new`} className={PRIMARY_LINK_BUTTON}>
            {t("facilities.new")}
          </Link>
        }
      />

      {/* A plain GET form: filters live in the URL and work without JavaScript. */}
      <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("facilities.type")}>
          <Select name="type" defaultValue={type ?? ""}>
            <option value="">{t("common.all")}</option>
            {FACILITY_TYPES.map((option) => (
              <option key={option} value={option}>
                {t(`facilityTypes.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("facilities.municipality")}>
          <Select name="municipality" defaultValue={municipality ?? ""}>
            <option value="">{t("common.all")}</option>
            {municipalityOptions.map((option) => (
              <option key={option.psgc_code} value={option.psgc_code}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("facilities.status")}>
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">{t("common.all")}</option>
            {VERIFICATION_STATUSES.map((option) => (
              <option key={option} value={option}>
                {t(`verificationStatus.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("facilities.lastVerified")}>
          <Select name="verified" defaultValue={verified ?? ""}>
            <option value="">{t("common.all")}</option>
            {VERIFIED_BUCKETS.map((option) => (
              <option key={option} value={option}>
                {t(`facilities.verifiedBuckets.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("facilities.missing")}>
          <Select name="missing" defaultValue={missing ?? ""}>
            <option value="">{t("common.all")}</option>
            {MISSING.map((option) => (
              <option key={option} value={option}>
                {t(`facilities.missingOptions.${option}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <button type="submit" className={PRIMARY_LINK_BUTTON}>
            {t("common.filter")}
          </button>
          <Link href={PATHNAME} className={LINK_BUTTON}>
            {t("common.clear")}
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty>{t("facilities.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((facility) => (
            <li key={facility.id}>
              <Link href={`${PATHNAME}/${facility.id}`} className={ROW_LINK}>
                <span className="font-medium">{facility.name}</span>
                <span className="text-sm text-zinc-600">
                  {t(`facilityTypes.${facility.facility_type}`)}
                  {facility.municipality_name ? ` · ${facility.municipality_name}` : ""}
                  {` · ${t(`verificationStatus.${facility.verification_status}`)}`}
                </span>
                <FreshnessBadge lastVerifiedAt={facility.last_verified_at} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />
    </>
  );
}
