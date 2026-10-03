import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LINK_BUTTON, PageHeader, PRIMARY_LINK_BUTTON } from "@/components/admin/fields";
import { DragBoard, type BoardDay } from "@/components/doctor/drag-board";
import { param } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { clinicNamesBySchedule, slotsBetween } from "@/lib/doctor/queries";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { addDays, datesBetween, groupByManilaDate, isoWeekday } from "@/lib/scheduling/generate";
import { MANILA_OFFSET, manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const PATHNAME = "/partner/doctor/calendar";
const VIEWS = ["day", "week", "month"] as const;
type View = (typeof VIEWS)[number];
const SLOT_LIMIT = 3000;
const APPOINTMENT_LIMIT = 1000;

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
function nextMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
function previousMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`;
}

/** The dates a view covers, and where its previous / next links go. */
function rangeFor(view: View, date: string) {
  if (view === "day") {
    return { start: date, end: addDays(date, 1), previous: addDays(date, -1), next: addDays(date, 1) };
  }
  if (view === "week") {
    const start = addDays(date, 1 - isoWeekday(date));
    return { start, end: addDays(start, 7), previous: addDays(start, -7), next: addDays(start, 7) };
  }
  const start = firstOfMonth(date);
  return { start, end: nextMonth(start), previous: previousMonth(start), next: nextMonth(start) };
}

export default async function CalendarPage({ searchParams }: PageProps<"/partner/doctor/calendar">) {
  const { supabase, actorId, practitioner } = await doctorContext();
  const t = await getTranslations("doctor");
  const weekdays = await getTranslations("admin.weekdays");
  const format = await getFormatter();
  const query = await searchParams;

  const view = VIEWS.find((option) => option === param(query, "view")) ?? "week";
  const requested = param(query, "date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) ? requested : manilaToday();
  const range = rangeFor(view, date);
  const fromIso = manilaDateToUtcIso(range.start);
  const toIso = manilaDateToUtcIso(range.end);

  const [slots, clinics] = await Promise.all([
    slotsBetween(supabase, fromIso, toIso, SLOT_LIMIT),
    clinicNamesBySchedule(supabase, practitioner.id),
  ]);
  const slotsByDate = groupByManilaDate(slots.map((slot) => ({ ...slot, startsAt: slot.starts_at })));
  const dayOf = (day: string) => new Date(`${day}T00:00:00${MANILA_OFFSET}`);
  const href = (nextView: View, nextDate: string) => `${PATHNAME}?view=${nextView}&date=${nextDate}`;

  const header = (
    <>
      <PageHeader
        title={
          view === "month"
            ? format.dateTime(dayOf(range.start), { month: "long", year: "numeric" })
            : view === "week"
              ? t("calendar.weekOf", { date: format.dateTime(dayOf(range.start), { dateStyle: "medium" }) })
              : format.dateTime(dayOf(date), { dateStyle: "full" })
        }
      />
      <nav className="flex flex-wrap gap-2">
        <Link href={href(view, range.previous)} className={LINK_BUTTON}>
          {t("calendar.previous")}
        </Link>
        <Link href={href(view, manilaToday())} className={LINK_BUTTON}>
          {t("calendar.today")}
        </Link>
        <Link href={href(view, range.next)} className={LINK_BUTTON}>
          {t("calendar.next")}
        </Link>
        {VIEWS.map((option) => (
          <Link
            key={option}
            href={href(option, date)}
            aria-current={option === view ? "page" : undefined}
            className={option === view ? PRIMARY_LINK_BUTTON : LINK_BUTTON}
          >
            {t(`calendar.views.${option}`)}
          </Link>
        ))}
      </nav>
    </>
  );

  if (view === "month") {
    // Counts only: no patient details on the month grid.
    const leading = isoWeekday(range.start) - 1;
    const cells: Array<string | null> = [
      ...Array.from({ length: leading }, () => null),
      ...datesBetween(range.start, range.end),
    ];
    return (
      <>
        {header}
        <div className="grid grid-cols-7 gap-1 text-xs">
          {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => (
            <div key={day} className="px-1 font-semibold text-zinc-600">
              {weekdays(`${day}`)}
            </div>
          ))}
          {cells.map((day, index) => {
            if (!day) return <div key={`pad-${index}`} />;
            const daySlots = slotsByDate.get(day) ?? [];
            const booked = daySlots.reduce((sum, slot) => sum + (slot.capacity - slot.remaining), 0);
            const free = daySlots.reduce((sum, slot) => sum + slot.remaining, 0);
            return (
              <Link
                key={day}
                href={href("day", day)}
                className={`flex min-h-16 flex-col gap-1 rounded border p-1 ${
                  day === manilaToday() ? "border-zinc-900" : "border-zinc-200"
                } ${daySlots.length === 0 ? "text-zinc-400" : ""}`}
              >
                <span className="font-medium">{Number(day.slice(8))}</span>
                {daySlots.length > 0 && (
                  <>
                    <span>{t("calendar.booked", { count: booked })}</span>
                    <span className="text-zinc-600">{t("calendar.free", { count: free })}</span>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      </>
    );
  }

  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select(APPOINTMENT_COLUMNS)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .neq("status", "cancelled")
    .order("starts_at")
    .order("id")
    .limit(APPOINTMENT_LIMIT);
  const appointments = (data ?? []) as unknown as AppointmentRow[];
  await logPatientReads(
    supabase,
    actorId,
    appointments.map((appointment) => appointment.patient_id),
    "appointment.calendar.read",
  );

  const now = new Date();
  const days: BoardDay[] = datesBetween(range.start, range.end).map((day) => ({
    date: day,
    label: format.dateTime(dayOf(day), { weekday: "short", month: "short", day: "numeric" }),
    slots: (slotsByDate.get(day) ?? []).map((slot) => ({
      id: slot.id,
      timeLabel: format.dateTime(new Date(slot.starts_at), { timeStyle: "short" }),
      clinic: clinics.get(slot.schedule_id) ?? "",
      seatsLabel: t("calendar.free", { count: slot.remaining }),
      open: slot.remaining > 0 && new Date(slot.starts_at) > now,
      appointments: appointments
        .filter((appointment) => appointment.slot_id === slot.id)
        .map((appointment) => ({
          id: appointment.id,
          name: appointment.patient_name,
          statusLabel: t(`status.${appointment.status}`),
          movable: appointment.status === "booked",
        })),
    })),
  }));

  return (
    <>
      {header}
      <p className="text-sm text-zinc-600">{t("calendar.dragHint")}</p>
      <DragBoard days={days} />
    </>
  );
}
