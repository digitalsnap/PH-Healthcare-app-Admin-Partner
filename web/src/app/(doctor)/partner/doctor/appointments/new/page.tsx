import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, PageHeader, Select } from "@/components/admin/fields";
import { param } from "@/lib/admin/pagination";
import { bookWalkIn } from "@/lib/doctor/actions/appointments";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { clinicNamesBySchedule, slotsBetween } from "@/lib/doctor/queries";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const BOOKING_WINDOW_DAYS = 14;
const SLOT_LIMIT = 300;
const PATIENT_LIMIT = 200;
const SERVICE_LIMIT = 500;

// Manual booking for a walk-in or a phone call.
export default async function NewAppointmentPage({
  searchParams,
}: PageProps<"/partner/doctor/appointments/new">) {
  const { supabase, actorId, practitioner } = await doctorContext();
  const t = await getTranslations("doctor.walkIn");
  const format = await getFormatter();
  const query = await searchParams;
  const now = new Date();

  const [slots, clinics, services, recent] = await Promise.all([
    // From the start of today, so a session already under way can take a walk-in.
    slotsBetween(
      supabase,
      manilaDateToUtcIso(manilaToday()),
      manilaDateToUtcIso(addDays(manilaToday(), BOOKING_WINDOW_DAYS)),
      SLOT_LIMIT,
    ),
    clinicNamesBySchedule(supabase, practitioner.id),
    supabase.from("service").select("id, name").order("name").limit(SERVICE_LIMIT),
    supabase
      .from("practitioner_appointment_view")
      .select("patient_id, patient_name")
      .order("starts_at", { ascending: false })
      .limit(PATIENT_LIMIT),
  ]);

  const open = slots.filter((slot) => slot.remaining > 0 && new Date(slot.ends_at) > now);
  const serviceOptions = (services.data ?? []) as { id: string; name: string }[];
  const patients = [
    ...new Map(
      ((recent.data ?? []) as { patient_id: string; patient_name: string }[]).map((row) => [
        row.patient_id,
        row.patient_name,
      ]),
    ),
  ];
  await logPatientReads(
    supabase,
    actorId,
    patients.map(([id]) => id),
    "patient_profile.list.read",
  );

  return (
    <>
      <PageHeader title={t("title")} />
      {open.length === 0 ? (
        <Empty>{t("noSlots")}</Empty>
      ) : (
        <ActionForm action={bookWalkIn} submitLabel={t("book")}>
          <Field label={t("slot")}>
            <Select name="slot_id" required defaultValue={param(query, "slot") ?? ""}>
              <option value="" disabled>
                {t("choose")}
              </option>
              {open.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {format.dateTime(new Date(slot.starts_at), {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {` · ${clinics.get(slot.schedule_id) ?? ""} · `}
                  {t("seatsLeft", { count: slot.remaining })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("service")}>
            <Select name="service_id" required defaultValue="">
              <option value="" disabled>
                {t("choose")}
              </option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </Field>

          {patients.length > 0 && (
            <Field label={t("returningPatient")} hint={t("returningPatientHint")}>
              <Select name="patient_id" defaultValue="">
                <option value="">{t("newPatient")}</option>
                {patients.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("patientName")}>
            <Input name="full_name" maxLength={200} autoComplete="off" />
          </Field>
          <Field label={t("patientPhone")} hint={t("patientPhoneHint")}>
            <Input name="phone" type="tel" inputMode="tel" maxLength={16} placeholder="09171234567" autoComplete="off" />
          </Field>

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="consent" required className="mt-1 size-5" />
            <span>{t("consent")}</span>
          </label>
        </ActionForm>
      )}
    </>
  );
}
