import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LIST, ROW_LINK } from "@/components/admin/fields";
import type { AppointmentRow } from "@/lib/doctor/types";

/** Appointment rows as large tap targets: time, patient, clinic, status. */
export async function AppointmentList({
  appointments,
  showDate = true,
}: {
  appointments: AppointmentRow[];
  showDate?: boolean;
}) {
  const t = await getTranslations("doctor");
  const format = await getFormatter();

  return (
    <ul className={LIST}>
      {appointments.map((appointment) => {
        const start = new Date(appointment.starts_at);
        return (
          <li key={appointment.id}>
            <Link href={`/partner/doctor/appointments/${appointment.id}`} className={ROW_LINK}>
              <span className="font-medium">
                {showDate
                  ? format.dateTime(start, { dateStyle: "medium", timeStyle: "short" })
                  : format.dateTime(start, { timeStyle: "short" })}
                {` · ${appointment.patient_name}`}
              </span>
              <span className="text-sm text-zinc-600">
                {[appointment.service_name, appointment.facility_name].filter(Boolean).join(" · ")}
              </span>
              <StatusBadge status={appointment.status} label={t(`status.${appointment.status}`)} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_STYLES: Record<AppointmentRow["status"], string> = {
  booked: "border-blue-300 bg-blue-50 text-blue-900",
  checked_in: "border-amber-400 bg-amber-100 text-amber-900",
  seen: "border-amber-400 bg-amber-100 text-amber-900",
  completed: "border-green-300 bg-green-50 text-green-900",
  cancelled: "border-zinc-300 bg-zinc-100 text-zinc-700",
  no_show: "border-red-400 bg-red-100 text-red-900",
};

export function StatusBadge({ status, label }: { status: AppointmentRow["status"]; label: string }) {
  return (
    <span className={`inline-flex w-fit rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {label}
    </span>
  );
}
