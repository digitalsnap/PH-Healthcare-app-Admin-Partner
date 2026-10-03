import { CalendarView } from "@/components/calendar/calendar-view";
import { param } from "@/lib/admin/pagination";
import { rescheduleByDrag } from "@/lib/doctor/actions/appointments";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { clinicNamesBySchedule, slotsBetween } from "@/lib/doctor/queries";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { calendarQuery, rangeFor } from "@/lib/scheduling/calendar";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const SLOT_LIMIT = 3000;
const APPOINTMENT_LIMIT = 1000;

export default async function CalendarPage({ searchParams }: PageProps<"/partner/doctor/calendar">) {
  const { supabase, actorId, practitioner } = await doctorContext();
  const query = await searchParams;
  const { view, date } = calendarQuery(param(query, "view"), param(query, "date"), manilaToday());
  const range = rangeFor(view, date);
  const fromIso = manilaDateToUtcIso(range.start);
  const toIso = manilaDateToUtcIso(range.end);

  const [slots, labels] = await Promise.all([
    slotsBetween(supabase, fromIso, toIso, SLOT_LIMIT),
    clinicNamesBySchedule(supabase, practitioner.id),
  ]);

  // The month grid shows counts only, so no patient details are read for it.
  let appointments: AppointmentRow[] = [];
  if (view !== "month") {
    const { data } = await supabase
      .from("practitioner_appointment_view")
      .select(APPOINTMENT_COLUMNS)
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
        appointments: "/partner/doctor/appointments",
        calendar: "/partner/doctor/calendar",
        newBooking: "/partner/doctor/appointments/new",
      }}
      move={rescheduleByDrag}
    />
  );
}
