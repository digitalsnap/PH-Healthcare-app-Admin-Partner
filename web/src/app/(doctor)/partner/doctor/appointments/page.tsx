import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Empty, LINK_BUTTON, PageHeader, PRIMARY_LINK_BUTTON } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { AppointmentList } from "@/components/doctor/appointment-list";
import { pageOf, param, rangeOf } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const PATHNAME = "/partner/doctor/appointments";
const TABS = ["today", "upcoming", "past"] as const;

export default async function AppointmentsPage({ searchParams }: PageProps<"/partner/doctor/appointments">) {
  const { supabase, actorId } = await doctorContext();
  const t = await getTranslations("doctor");
  const query = await searchParams;
  const tab = TABS.find((option) => option === param(query, "tab")) ?? "today";
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const todayStart = manilaDateToUtcIso(manilaToday());
  const tomorrowStart = manilaDateToUtcIso(addDays(manilaToday(), 1));

  let list = supabase.from("practitioner_appointment_view").select(APPOINTMENT_COLUMNS, { count: "exact" });
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
        title={t("appointments.title")}
        action={
          <Link href={`${PATHNAME}/new`} className={PRIMARY_LINK_BUTTON}>
            {t("walkIn.title")}
          </Link>
        }
      />

      <nav className="flex gap-2">
        {TABS.map((option) => (
          <Link
            key={option}
            href={option === "today" ? PATHNAME : `${PATHNAME}?tab=${option}`}
            aria-current={option === tab ? "page" : undefined}
            className={option === tab ? PRIMARY_LINK_BUTTON : LINK_BUTTON}
          >
            {t(`appointments.tabs.${option}`)}
          </Link>
        ))}
      </nav>

      {appointments.length === 0 ? (
        <Empty>{t("appointments.empty")}</Empty>
      ) : (
        <AppointmentList appointments={appointments} showDate={tab !== "today"} />
      )}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />
    </>
  );
}
