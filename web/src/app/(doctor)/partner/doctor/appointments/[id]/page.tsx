import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Facts, Field, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { StatusBadge } from "@/components/doctor/appointment-list";
import { idSchema } from "@/lib/admin/schemas";
import {
  cancelAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
} from "@/lib/doctor/actions/appointments";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { clinicNamesBySchedule, slotsBetween } from "@/lib/doctor/queries";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { addDays } from "@/lib/scheduling/generate";
import {
  CANCEL_REASONS,
  canCancel,
  canMarkNoShow,
  nextSteps,
} from "@/lib/scheduling/transitions";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const RESCHEDULE_WINDOW_DAYS = 28;
const SLOT_LIMIT = 300;

type EventRow = {
  id: string;
  event: "booked" | "rescheduled" | "cancelled" | "no_show" | "checked_in" | "seen" | "completed";
  at: string;
};
type SmsRow = {
  id: string;
  template: "booking_confirmed" | "booking_rescheduled" | "booking_cancelled" | "appointment_reminder";
  status: "queued" | "sent" | "failed" | "cancelled";
  scheduled_at: string;
};

export default async function AppointmentPage({ params }: PageProps<"/partner/doctor/appointments/[id]">) {
  const { supabase, actorId, practitioner } = await doctorContext();
  const t = await getTranslations("doctor");
  const format = await getFormatter();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select(APPOINTMENT_COLUMNS)
    .eq("id", id.data)
    .maybeSingle();
  if (!data) notFound();
  const appointment = data as unknown as AppointmentRow;
  await logPatientReads(supabase, actorId, [appointment.patient_id], "appointment.read");

  const now = new Date();
  const reschedulable = appointment.status === "booked";
  const [events, messages, slots, clinics] = await Promise.all([
    supabase
      .from("appointment_event")
      .select("id, event, at")
      .eq("appointment_id", appointment.id)
      .order("at")
      .order("id"),
    supabase
      .from("sms_message")
      .select("id, template, status, scheduled_at")
      .eq("appointment_id", appointment.id)
      .order("scheduled_at")
      .order("id"),
    reschedulable
      ? slotsBetween(
          supabase,
          now.toISOString(),
          manilaDateToUtcIso(addDays(manilaToday(), RESCHEDULE_WINDOW_DAYS)),
          SLOT_LIMIT,
        )
      : Promise.resolve([]),
    clinicNamesBySchedule(supabase, practitioner.id),
  ]);
  const eventRows = (events.data ?? []) as EventRow[];
  const smsRows = (messages.data ?? []) as SmsRow[];
  const targets = slots.filter((slot) => slot.remaining > 0 && slot.id !== appointment.slot_id);

  const dateTime = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const steps = nextSteps(appointment.status);
  const noShow = canMarkNoShow(appointment.status, appointment.starts_at, now);
  const cancellable = canCancel(appointment.status);

  return (
    <>
      <PageHeader title={appointment.patient_name} />
      <StatusBadge status={appointment.status} label={t(`status.${appointment.status}`)} />

      <Facts
        items={[
          [t("detail.when"), `${dateTime(appointment.starts_at)} – ${format.dateTime(new Date(appointment.ends_at), { timeStyle: "short" })}`],
          [t("detail.clinic"), appointment.facility_name ?? t("detail.none")],
          [t("detail.service"), appointment.service_name ?? t("detail.none")],
          [t("detail.phone"), appointment.patient_phone ?? t("detail.noPhone")],
          [t("detail.bookingCode"), appointment.booking_code ?? t("detail.none")],
          [t("detail.channel"), t(`channels.${appointment.channel}`)],
          ...(appointment.cancel_reason
            ? [[t("detail.cancelReason"), t(`cancelReasons.${appointment.cancel_reason}`)] as [string, string]]
            : []),
        ]}
      />

      {(steps.length > 0 || noShow) && (
        <Section title={t("detail.visit")}>
          {steps.map((status) => (
            <ActionForm key={status} action={setAppointmentStatus} submitLabel={t(`detail.mark.${status}`)}>
              <input type="hidden" name="id" value={appointment.id} />
              <input type="hidden" name="status" value={status} />
            </ActionForm>
          ))}
          {noShow && (
            <ActionForm action={setAppointmentStatus} submitLabel={t("detail.mark.no_show")} variant="danger">
              <input type="hidden" name="id" value={appointment.id} />
              <input type="hidden" name="status" value="no_show" />
            </ActionForm>
          )}
        </Section>
      )}

      {reschedulable && (
        <Section title={t("detail.reschedule")}>
          <p className="text-sm text-zinc-600">{t("detail.rescheduleHint")}</p>
          {targets.length === 0 ? (
            <Empty>{t("detail.noSlots")}</Empty>
          ) : (
            <ActionForm action={rescheduleAppointment} submitLabel={t("detail.reschedule")} variant="secondary">
              <input type="hidden" name="id" value={appointment.id} />
              <Field label={t("detail.newSlot")}>
                <Select name="slot_id" required defaultValue="">
                  <option value="" disabled>
                    {t("walkIn.choose")}
                  </option>
                  {targets.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {format.dateTime(new Date(slot.starts_at), {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {` · ${clinics.get(slot.schedule_id) ?? ""}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          )}
        </Section>
      )}

      {cancellable && (
        <Section title={t("detail.cancel")}>
          <p className="text-sm text-zinc-600">{t("detail.cancelHint")}</p>
          <ActionForm action={cancelAppointment} submitLabel={t("detail.cancel")} variant="danger">
            <input type="hidden" name="id" value={appointment.id} />
            <Field label={t("detail.cancelReason")}>
              <Select name="cancel_reason" required defaultValue="">
                <option value="" disabled>
                  {t("walkIn.choose")}
                </option>
                {CANCEL_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`cancelReasons.${reason}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </Section>
      )}

      <Section title={t("detail.history")}>
        <ul className={LIST}>
          {eventRows.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <span className="font-medium">{t(`events.${event.event}`)}</span>
              <span className="text-zinc-600">{dateTime(event.at)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("detail.messages")}>
        {smsRows.length === 0 ? (
          <Empty>{appointment.patient_phone ? t("detail.noMessages") : t("detail.noPhoneNoSms")}</Empty>
        ) : (
          <ul className={LIST}>
            {smsRows.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <span className="font-medium">{t(`sms.templates.${message.template}`)}</span>
                <span className="text-zinc-600">
                  {t(`sms.statuses.${message.status}`)} · {dateTime(message.scheduled_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
