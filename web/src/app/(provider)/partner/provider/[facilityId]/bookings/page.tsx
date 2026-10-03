import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Empty, LINK_BUTTON, PageHeader, PRIMARY_LINK_BUTTON } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { AppointmentList } from "@/components/doctor/appointment-list";
import { pageOf, param, rangeOf } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const TABS = ["today", "upcoming", "past"] as const;

export default async function BookingsPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/bookings">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "bookings");
  const t = await getTranslations("provider");
  const tabs = await getTranslations("doctor.appointments");
  const query = await searchParams;
  const tab = TABS.find((option) => option === param(query, "tab")) ?? "today";
  const page = pageOf(query);
  const [from, to] = rangeOf(page);
  const pathname = facilityPath(facility.id, "bookings");

  const todayStart = manilaDateToUtcIso(manilaToday());
  const tomorrowStart = manilaDateToUtcIso(addDays(manilaToday(), 1));

  let list = supabase
    .from("practitioner_appointment_view")
    .select(APPOINTMENT_COLUMNS, { count: "exact" })
    .eq("facility_id", facility.id);
  if (tab === "today") list = list.gte("starts_at", todayStart).lt("starts_at", tomorrowStart);
  if (tab === "upcoming") list = list.gte("starts_at", tomorrowStart);
  if (tab === "past") list = list.lt("starts_at", todayStart);

  const { data, count } = await list
    .order("starts_at", { ascending: tab !== "past" })
    .order("id")
    .range(from, to);
  const appointments = (data ?? []) as unknown as AppointmentRow[];
  await logPatientReads(
    supabase,
    actorId,
    appointments.map((appointment) => appointment.patient_id),
    "appointment.list.read",
  );

  return (
    <>
      <PageHeader
        title={t("bookings.title")}
        action={
          <Link href={`${pathname}/new`} className={PRIMARY_LINK_BUTTON}>
            {t("bookings.new")}
          </Link>
        }
      />
      <nav className="flex gap-2">
        {TABS.map((option) => (
          <Link
            key={option}
            href={option === "today" ? pathname : `${pathname}?tab=${option}`}
            aria-current={option === tab ? "page" : undefined}
            className={option === tab ? PRIMARY_LINK_BUTTON : LINK_BUTTON}
          >
            {tabs(`tabs.${option}`)}
          </Link>
        ))}
      </nav>

      {appointments.length === 0 ? (
        <Empty>{tabs("empty")}</Empty>
      ) : (
        <AppointmentList appointments={appointments} showDate={tab !== "today"} basePath={pathname} />
      )}
      <Pagination pathname={pathname} searchParams={query} page={page} total={count ?? 0} />
    </>
  );
}
