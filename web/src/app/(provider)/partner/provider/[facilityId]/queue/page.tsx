import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, LIST, PageHeader, PRIMARY_LINK_BUTTON, Section } from "@/components/admin/fields";
import { logPatientReads } from "@/lib/doctor/audit";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { setBookingStatus } from "@/lib/provider/actions/bookings";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { addDays } from "@/lib/scheduling/generate";
import { canMarkNoShow } from "@/lib/scheduling/transitions";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const TODAY_LIMIT = 300;

// Today's queue for a clinic: who is being seen, who is waiting (in the order
// they checked in), and who has not arrived yet.
export default async function QueuePage({ params }: PageProps<"/partner/provider/[facilityId]/queue">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "queue");
  const t = await getTranslations("provider.queue");
  const d = await getTranslations("doctor.detail");
  const format = await getFormatter();
  const today = manilaToday();
  const now = new Date();

  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select(APPOINTMENT_COLUMNS)
    .eq("facility_id", facility.id)
    .gte("starts_at", manilaDateToUtcIso(today))
    .lt("starts_at", manilaDateToUtcIso(addDays(today, 1)))
    .order("starts_at")
    .order("id")
    .limit(TODAY_LIMIT);
  const appointments = (data ?? []) as unknown as AppointmentRow[];
  await logPatientReads(
    supabase,
    actorId,
    appointments.map((appointment) => appointment.patient_id),
    "appointment.queue.read",
  );

  // Queue order is the order of check-in, not of booking.
  const waitingIds = appointments.filter((row) => row.status === "checked_in").map((row) => row.id);
  const { data: checkIns } =
    waitingIds.length > 0
      ? await supabase
          .from("appointment_event")
          .select("appointment_id, at")
          .in("appointment_id", waitingIds)
          .eq("event", "checked_in")
      : { data: [] };
  const checkedInAt = new Map(
    ((checkIns ?? []) as { appointment_id: string; at: string }[]).map((row) => [row.appointment_id, row.at]),
  );

  const beingSeen = appointments.filter((row) => row.status === "seen");
  const waiting = appointments
    .filter((row) => row.status === "checked_in")
    .sort((a, b) => (checkedInAt.get(a.id) ?? "").localeCompare(checkedInAt.get(b.id) ?? ""));
  const expected = appointments.filter((row) => row.status === "booked");
  const done = appointments.filter((row) => row.status === "completed").length;
  const time = (value: string) => format.dateTime(new Date(value), { timeStyle: "short" });

  const row = (appointment: AppointmentRow, position: number | null, next: "checked_in" | "seen" | "completed") => (
    <li key={appointment.id} className="flex flex-col gap-2 px-3 py-3">
      <Link href={facilityPath(facility.id, `bookings/${appointment.id}`)} className="font-medium underline">
        {position !== null ? `${position}. ` : ""}
        {appointment.patient_name}
      </Link>
      <span className="text-sm text-zinc-600">
        {time(appointment.starts_at)}
        {appointment.service_name ? ` · ${appointment.service_name}` : ""}
      </span>
      <div className="flex flex-wrap gap-2">
        <ActionForm action={setBookingStatus} submitLabel={d(`mark.${next}`)}>
          <input type="hidden" name="facility_id" value={facility.id} />
          <input type="hidden" name="id" value={appointment.id} />
          <input type="hidden" name="status" value={next} />
        </ActionForm>
        {canMarkNoShow(appointment.status, appointment.starts_at, now) && (
          <ActionForm action={setBookingStatus} submitLabel={d("mark.no_show")} variant="danger">
            <input type="hidden" name="facility_id" value={facility.id} />
            <input type="hidden" name="id" value={appointment.id} />
            <input type="hidden" name="status" value="no_show" />
          </ActionForm>
        )}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        action={
          <Link href={facilityPath(facility.id, "bookings/new")} className={PRIMARY_LINK_BUTTON}>
            {t("addWalkIn")}
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [t("beingSeen"), beingSeen.length],
            [t("waiting"), waiting.length],
            [t("expected"), expected.length],
            [t("done"), done],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="flex flex-col rounded border border-zinc-200 p-3">
            <span className="text-2xl font-semibold">{count}</span>
            <span className="text-sm text-zinc-600">{label}</span>
          </div>
        ))}
      </div>

      <Section title={t("beingSeen")}>
        {beingSeen.length === 0 ? (
          <Empty>{t("none")}</Empty>
        ) : (
          <ul className={LIST}>{beingSeen.map((appointment) => row(appointment, null, "completed"))}</ul>
        )}
      </Section>
      <Section title={t("waiting")}>
        {waiting.length === 0 ? (
          <Empty>{t("none")}</Empty>
        ) : (
          <ul className={LIST}>{waiting.map((appointment, index) => row(appointment, index + 1, "seen"))}</ul>
        )}
      </Section>
      <Section title={t("expected")}>
        {expected.length === 0 ? (
          <Empty>{t("none")}</Empty>
        ) : (
          <ul className={LIST}>{expected.map((appointment) => row(appointment, null, "checked_in"))}</ul>
        )}
      </Section>
    </>
  );
}
