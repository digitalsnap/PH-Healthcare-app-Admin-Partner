import { getTranslations } from "next-intl/server";

/**
 * PRC status at a glance. An unverified practitioner is shown as blocked: the
 * profile cannot go live and the calendar cannot take bookings.
 */
export async function PrcBadge({
  verified,
  live,
  prominent = false,
}: {
  verified: boolean;
  live: boolean;
  prominent?: boolean;
}) {
  const t = await getTranslations("admin.practitioners");
  const size = prominent ? "px-3 py-2 text-base" : "px-2 py-0.5 text-xs";

  if (!verified) {
    return (
      <span className={`inline-flex w-fit rounded border border-red-400 bg-red-100 font-medium text-red-900 ${size}`}>
        {t("blocked")}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex w-fit rounded border border-green-300 bg-green-50 font-medium text-green-900 ${size}`}
    >
      {live ? t("verifiedLive") : t("verifiedNotLive")}
    </span>
  );
}
