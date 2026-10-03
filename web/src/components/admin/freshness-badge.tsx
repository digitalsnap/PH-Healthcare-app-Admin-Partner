import { getFormatter, getTranslations } from "next-intl/server";
import { freshnessOf, type Freshness } from "@/lib/admin/freshness";

const STYLES: Record<Freshness, string> = {
  fresh: "border-green-300 bg-green-50 text-green-900",
  amber: "border-amber-400 bg-amber-100 text-amber-900",
  red: "border-red-400 bg-red-100 text-red-900",
  never: "border-red-400 bg-red-100 text-red-900",
};

/**
 * The "last verified" badge: amber past 60 days, red past 90 or when the
 * listing has never been verified. The state is written out, not only coloured.
 */
export async function FreshnessBadge({
  lastVerifiedAt,
  prominent = false,
}: {
  lastVerifiedAt: string | null;
  prominent?: boolean;
}) {
  const t = await getTranslations("admin.freshness");
  const format = await getFormatter();
  const freshness = freshnessOf(lastVerifiedAt);

  const text = lastVerifiedAt
    ? t("lastVerified", { date: format.dateTime(new Date(lastVerifiedAt), { dateStyle: "medium" }) })
    : t("neverVerified");

  return (
    <span
      className={`inline-flex w-fit flex-wrap items-center gap-x-2 rounded border font-medium ${STYLES[freshness]} ${
        prominent ? "px-3 py-2 text-base" : "px-2 py-0.5 text-xs"
      }`}
    >
      {text}
      {(freshness === "amber" || freshness === "red") && <span>· {t(freshness)}</span>}
    </span>
  );
}
