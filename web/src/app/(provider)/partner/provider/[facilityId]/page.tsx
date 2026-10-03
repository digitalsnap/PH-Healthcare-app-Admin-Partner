import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Facts, LINK_BUTTON, PageHeader, PRIMARY_LINK_BUTTON } from "@/components/admin/fields";
import { FreshnessBadge } from "@/components/admin/freshness-badge";
import { WEEKDAYS } from "@/lib/admin/schemas";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { accreditationStatus } from "@/lib/provider/queries";

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex w-fit rounded border px-3 py-2 text-base font-medium ${
        on ? "border-green-300 bg-green-50 text-green-900" : "border-zinc-300 bg-zinc-100 text-zinc-700"
      }`}
    >
      {label}
    </span>
  );
}

// A facility's overview: how it appears to patients, and its coverage badges.
export default async function FacilityOverviewPage({ params }: PageProps<"/partner/provider/[facilityId]">) {
  const { supabase, facility, segment } = await facilityContext((await params).facilityId);
  const t = await getTranslations("provider");
  const days = await getTranslations("admin.weekdays");
  const status = await getTranslations("admin.verificationStatus");
  const accreditation = await accreditationStatus(supabase, facility.id);

  const hours = WEEKDAYS.filter((day) => facility.hours[String(day)]).map(
    (day) => `${days(`${day}`)} ${facility.hours[String(day)].open}–${facility.hours[String(day)].close}`,
  );

  return (
    <>
      <PageHeader
        title={facility.name}
        action={
          <Link href={facilityPath(facility.id, "profile")} className={LINK_BUTTON}>
            {t("overview.editProfile")}
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <FreshnessBadge lastVerifiedAt={facility.last_verified_at} prominent />
        {segment === "clinic" && (
          <Badge on={accreditation.yakap} label={accreditation.yakap ? t("overview.yakapOn") : t("overview.yakapOff")} />
        )}
        {segment === "pharmacy" && (
          <Badge on={accreditation.gamot} label={accreditation.gamot ? t("overview.gamotOn") : t("overview.gamotOff")} />
        )}
      </div>
      <p className="text-sm text-zinc-600">{t("overview.badgeHint")}</p>

      <Facts
        items={[
          [t("overview.listing"), status(facility.verification_status)],
          [t("profile.address"), facility.address_line ?? t("common.none")],
          [t("profile.phone"), facility.phone ?? t("common.none")],
          [t("profile.hours"), hours.length > 0 ? hours.join(" · ") : t("common.none")],
        ]}
      />

      <div className="flex flex-wrap gap-2">
        {segment === "pharmacy" ? (
          <>
            <Link href={facilityPath(facility.id, "stock")} className={PRIMARY_LINK_BUTTON}>
              {t("nav.stock")}
            </Link>
            <Link href={facilityPath(facility.id, "reservations")} className={LINK_BUTTON}>
              {t("nav.reservations")}
            </Link>
          </>
        ) : (
          <>
            <Link href={facilityPath(facility.id, "bookings/new")} className={PRIMARY_LINK_BUTTON}>
              {t("bookings.new")}
            </Link>
            <Link href={facilityPath(facility.id, "bookings")} className={LINK_BUTTON}>
              {t("nav.bookings")}
            </Link>
          </>
        )}
      </div>
    </>
  );
}
