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
import { Pagination } from "@/components/admin/pagination";
import { PrcBadge } from "@/components/admin/prc-badge";
import { adminContext } from "@/lib/admin/context";
import { pageOf, param, rangeOf } from "@/lib/admin/pagination";
import type { PractitionerRow } from "@/lib/admin/types";

const PATHNAME = "/admin/practitioners";
const PRC_FILTERS = ["verified", "unverified"] as const;

export default async function PractitionersPage({ searchParams }: PageProps<"/admin/practitioners">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const query = await searchParams;
  const prc = PRC_FILTERS.find((option) => option === param(query, "prc"));
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  let list = supabase
    .from("practitioner")
    .select("id, full_name, prc_number, specialties, prc_verified_at, is_live", { count: "exact" });
  if (prc === "verified") list = list.not("prc_verified_at", "is", null);
  if (prc === "unverified") list = list.is("prc_verified_at", null);

  const { data, count } = await list.order("full_name").order("id").range(from, to);
  const rows = (data ?? []) as Pick<
    PractitionerRow,
    "id" | "full_name" | "prc_number" | "specialties" | "prc_verified_at" | "is_live"
  >[];

  return (
    <>
      <PageHeader
        title={t("practitioners.title")}
        action={
          <Link href={`${PATHNAME}/new`} className={PRIMARY_LINK_BUTTON}>
            {t("practitioners.new")}
          </Link>
        }
      />

      <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("practitioners.prcStatus")}>
          <Select name="prc" defaultValue={prc ?? ""}>
            <option value="">{t("common.all")}</option>
            {PRC_FILTERS.map((option) => (
              <option key={option} value={option}>
                {t(`practitioners.prcFilters.${option}`)}
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
        <Empty>{t("practitioners.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((practitioner) => (
            <li key={practitioner.id}>
              <Link href={`${PATHNAME}/${practitioner.id}`} className={ROW_LINK}>
                <span className="font-medium">{practitioner.full_name}</span>
                <span className="text-sm text-zinc-600">
                  {practitioner.specialties.length > 0
                    ? practitioner.specialties.join(", ")
                    : t("practitioners.noSpecialties")}
                </span>
                <PrcBadge verified={practitioner.prc_verified_at !== null} live={practitioner.is_live} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />
    </>
  );
}
