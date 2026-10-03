import { CalendarView } from "@/components/calendar/calendar-view";
import { param } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { slotsBetween } from "@/lib/doctor/queries";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { rescheduleBookingByDrag } from "@/lib/provider/actions/bookings";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { resourceSchedules } from "@/lib/provider/queries";
import { calendarQuery, rangeFor } from "@/lib/scheduling/calendar";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const SLOT_LIMIT = 3000;
const APPOINTMENT_LIMIT = 1000;

// The facility's own resources on a month, week or day calendar. A doctor's
// slots held at the facility are on that doctor's calendar, not here.
export default async function FacilityCalendarPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/calendar">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "calendar");
  const query = await searchParams;
  const { view, date } = calendarQuery(param(query, "view"), param(query, "date"), manilaToday());
  const range = rangeFor(view, date);
  const fromIso = manilaDateToUtcIso(range.start);
  const toIso = manilaDateToUtcIso(range.end);

  const [allSlots, schedules] = await Promise.all([
    slotsBetween(supabase, fromIso, toIso, SLOT_LIMIT),
    resourceSchedules(supabase, facility.id),
  ]);
  const labels = new Map(schedules.map((schedule) => [schedule.id, schedule.facility_resource]));
  const slots = allSlots.filter((slot) => labels.has(slot.schedule_id));

  // The month grid shows counts only, so no patient details are read for it.
  let appointments: AppointmentRow[] = [];
  if (view !== "month") {
    const { data } = await supabase
      .from("practitioner_appointment_view")
      .select(APPOINTMENT_COLUMNS)
      .eq("facility_id", facility.id)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso)
      .neq("status", "cancelled")
      .order("starts_at")
      .order("id")
      .limit(APPOINTMENT_LIMIT);
    appointments = (data ?? []) as unknown as AppointmentRow[];
    await logPatientReads(
      supabase,
      actorId,
      appointments.map((appointment) => appointment.patient_id),
      "appointment.calendar.read",
    );
  }

  return (
    <CalendarView
      view={view}
      date={date}
      slots={slots}
      appointments={appointments}
      labels={labels}
      paths={{
        appointments: facilityPath(facility.id, "bookings"),
        calendar: facilityPath(facility.id, "calendar"),
        newBooking: facilityPath(facility.id, "bookings/new"),
      }}
      move={rescheduleBookingByDrag.bind(null, facility.id)}
    />
  );
}
