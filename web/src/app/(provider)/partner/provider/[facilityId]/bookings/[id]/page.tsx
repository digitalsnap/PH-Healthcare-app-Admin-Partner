import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Facts, Field, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { StatusBadge } from "@/components/doctor/appointment-list";
import { idSchema } from "@/lib/admin/schemas";
import { logPatientReads } from "@/lib/doctor/audit";
import { slotsBetween } from "@/lib/doctor/queries";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { cancelBooking, rescheduleBooking, setBookingStatus } from "@/lib/provider/actions/bookings";
import { facilityContext } from "@/lib/provider/context";
import { resourceSchedules } from "@/lib/provider/queries";
import { addDays } from "@/lib/scheduling/generate";
import { CANCEL_REASONS, canCancel, canMarkNoShow, nextSteps } from "@/lib/scheduling/transitions";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const RESCHEDULE_WINDOW_DAYS = 28;
const SLOT_LIMIT = 300;

type EventRow = {
  id: string;
  event: "booked" | "rescheduled" | "cancelled" | "no_show" | "checked_in" | "seen" | "completed";
  at: string;
};

export default async function BookingPage({ params }: PageProps<"/partner/provider/[facilityId]/bookings/[id]">) {
  const { facilityId, id: rawId } = await params;
  const { supabase, actorId, facility } = await facilityContext(facilityId, "bookings");
  const t = await getTranslations("doctor");
  const p = await getTranslations("provider.bookings");
  const format = await getFormatter();
  const id = idSchema.safeParse(rawId);
  if (!id.success) notFound();

  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select(`${APPOINTMENT_COLUMNS}, home_service`)
    .eq("id", id.data)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!data) notFound();
  const appointment = data as unknown as AppointmentRow & { home_service: boolean };
  await logPatientReads(supabase, actorId, [appointment.patient_id], "appointment.read");

  const now = new Date();
  const reschedulable = appointment.status === "booked";
  const [events, visit, slots, schedules] = await Promise.all([
    supabase
      .from("appointment_event")
      .select("id, event, at")
      .eq("appointment_id", appointment.id)
      .order("at")
      .order("id"),
    appointment.home_service
      ? supabase
          .from("appointment_home_visit")
          .select("address_line, landmark")
          .eq("appointment_id", appointment.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    reschedulable
      ? slotsBetween(
          supabase,
          now.toISOString(),
          manilaDateToUtcIso(addDays(manilaToday(), RESCHEDULE_WINDOW_DAYS)),
          SLOT_LIMIT,
        )
      : Promise.resolve([]),
    resourceSchedules(supabase, facility.id),
  ]);
  const eventRows = (events.data ?? []) as EventRow[];
  const homeVisit = visit.data as { address_line: string; landmark: string | null } | null;
  const resourceNames = new Map(schedules.map((schedule) => [schedule.id, schedule.facility_resource]));
  const targets = slots.filter(
    (slot) => resourceNames.has(slot.schedule_id) && slot.remaining > 0 && slot.id !== appointment.slot_id,
  );

  const dateTime = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const steps = nextSteps(appointment.status);
  const noShow = canMarkNoShow(appointment.status, appointment.starts_at, now);

  return (
    <>
      <PageHeader title={appointment.patient_name} />
      <StatusBadge status={appointment.status} label={t(`status.${appointment.status}`)} />

      <Facts
        items={[
          [
            t("detail.when"),
            `${dateTime(appointment.starts_at)} – ${format.dateTime(new Date(appointment.ends_at), { timeStyle: "short" })}`,
          ],
          [p("resource"), resourceNames.get(appointment.schedule_id) ?? p("doctorSchedule")],
          [t("detail.service"), appointment.service_name ?? t("detail.none")],
          [t("detail.phone"), appointment.patient_phone ?? t("detail.noPhone")],
          [t("detail.bookingCode"), appointment.booking_code ?? t("detail.none")],
          [t("detail.channel"), t(`channels.${appointment.channel}`)],
          ...(homeVisit
            ? [
                [
                  p("homeService"),
                  homeVisit.landmark ? `${homeVisit.address_line} (${homeVisit.landmark})` : homeVisit.address_line,
                ] as [string, string],
              ]
            : []),
          ...(appointment.cancel_reason
            ? [[t("detail.cancelReason"), t(`cancelReasons.${appointment.cancel_reason}`)] as [string, string]]
            : []),
        ]}
      />

      {(steps.length > 0 || noShow) && (
        <Section title={t("detail.visit")}>
          {steps.map((status) => (
            <ActionForm key={status} action={setBookingStatus} submitLabel={t(`detail.mark.${status}`)}>
              <input type="hidden" name="facility_id" value={facility.id} />
              <input type="hidden" name="id" value={appointment.id} />
              <input type="hidden" name="status" value={status} />
            </ActionForm>
          ))}
          {noShow && (
            <ActionForm action={setBookingStatus} submitLabel={t("detail.mark.no_show")} variant="danger">
              <input type="hidden" name="facility_id" value={facility.id} />
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
            <ActionForm action={rescheduleBooking} submitLabel={t("detail.reschedule")} variant="secondary">
              <input type="hidden" name="facility_id" value={facility.id} />
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
                      {` · ${resourceNames.get(slot.schedule_id)}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          )}
        </Section>
      )}

      {canCancel(appointment.status) && (
        <Section title={t("detail.cancel")}>
          <p className="text-sm text-zinc-600">{t("detail.cancelHint")}</p>
          <ActionForm action={cancelBooking} submitLabel={t("detail.cancel")} variant="danger">
            <input type="hidden" name="facility_id" value={facility.id} />
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
    </>
  );
}
