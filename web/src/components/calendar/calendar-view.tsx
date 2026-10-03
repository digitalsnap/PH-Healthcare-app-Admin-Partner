import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LINK_BUTTON, PageHeader, PRIMARY_LINK_BUTTON } from "@/components/admin/fields";
import type { AppointmentRow, SlotRow } from "@/lib/doctor/types";
import { CALENDAR_VIEWS, rangeFor, type CalendarViewName } from "@/lib/scheduling/calendar";
import { datesBetween, groupByManilaDate, isoWeekday } from "@/lib/scheduling/generate";
import { MANILA_OFFSET, manilaToday } from "@/lib/time/manila";
import { DragBoard, type BoardDay, type BoardPaths, type MoveAction } from "./drag-board";

/**
 * Month, week and day calendar, used by the doctor dashboard and by the
 * clinic and diagnostics portals. The caller fetches the slots (and, for week
 * and day, the appointments) for the range; this lays them out.
 *
 * The month grid shows counts only — no patient details. Week and day show
 * names, so the caller must have logged those reads.
 */
export async function CalendarView({
  view,
  date,
  slots,
  appointments,
  labels,
  paths,
  move,
}: {
  view: CalendarViewName;
  date: string;
  slots: SlotRow[];
  /** Not needed for the month view. */
  appointments: AppointmentRow[];
  /** What to call each schedule a slot belongs to: a clinic, or a resource. */
  labels: Map<string, string>;
  paths: BoardPaths;
  move: MoveAction;
}) {
  const t = await getTranslations("doctor");
  const weekdays = await getTranslations("admin.weekdays");
  const format = await getFormatter();
  const range = rangeFor(view, date);
  const today = manilaToday();

  const slotsByDate = groupByManilaDate(slots.map((slot) => ({ ...slot, startsAt: slot.starts_at })));
  const dayOf = (day: string) => new Date(`${day}T00:00:00${MANILA_OFFSET}`);
  const href = (nextView: CalendarViewName, nextDate: string) =>
    `${paths.calendar}?view=${nextView}&date=${nextDate}`;

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
        <Link href={href(view, today)} className={LINK_BUTTON}>
          {t("calendar.today")}
        </Link>
        <Link href={href(view, range.next)} className={LINK_BUTTON}>
          {t("calendar.next")}
        </Link>
        {CALENDAR_VIEWS.map((option) => (
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
                  day === today ? "border-zinc-900" : "border-zinc-200"
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

  const now = new Date();
  const days: BoardDay[] = datesBetween(range.start, range.end).map((day) => ({
    date: day,
    label: format.dateTime(dayOf(day), { weekday: "short", month: "short", day: "numeric" }),
    slots: (slotsByDate.get(day) ?? []).map((slot) => ({
      id: slot.id,
      timeLabel: format.dateTime(new Date(slot.starts_at), { timeStyle: "short" }),
      clinic: labels.get(slot.schedule_id) ?? "",
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
      <DragBoard days={days} paths={paths} move={move} />
    </>
  );
}
