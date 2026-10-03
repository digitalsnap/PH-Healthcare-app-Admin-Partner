import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, PageHeader, Section, Select } from "@/components/admin/fields";
import { CounterPatientFields } from "@/components/provider/counter-patient-fields";
import { param } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { slotsBetween } from "@/lib/doctor/queries";
import { bookAtCounter } from "@/lib/provider/actions/bookings";
import { facilityContext } from "@/lib/provider/context";
import { knownPatients, resourceSchedules } from "@/lib/provider/queries";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const BOOKING_WINDOW_DAYS = 14;
const SLOT_LIMIT = 300;
const PATIENT_LIMIT = 200;
const OPTION_LIMIT = 500;

// Assisted booking: staff book for a walk-in or a caller, with the patient's
// consent recorded at the counter.
export default async function NewBookingPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/bookings/new">) {
  const { supabase, actorId, facility, segment } = await facilityContext((await params).facilityId, "bookings");
  const t = await getTranslations("provider");
  const format = await getFormatter();
  const query = await searchParams;
  const now = new Date();

  const [slots, schedules, services, patients, barangays] = await Promise.all([
    slotsBetween(
      supabase,
      manilaDateToUtcIso(manilaToday()),
      manilaDateToUtcIso(addDays(manilaToday(), BOOKING_WINDOW_DAYS)),
      SLOT_LIMIT,
    ),
    resourceSchedules(supabase, facility.id),
    supabase.from("service").select("id, name").neq("service_type", "medicine").order("name").limit(OPTION_LIMIT),
    knownPatients(supabase, facility.id, PATIENT_LIMIT),
    segment === "diagnostics"
      ? supabase
          .from("location")
          .select("psgc_code, name")
          .eq("level", "barangay")
          .eq("municipality_code", facility.municipality_code)
          .order("name")
          .limit(OPTION_LIMIT)
      : Promise.resolve({ data: [] }),
  ]);
  const resourceNames = new Map(schedules.map((schedule) => [schedule.id, schedule.facility_resource]));
  // Only this facility's own resources are offered here; a doctor's slots are
  // booked from the doctor's dashboard.
  const open = slots.filter(
    (slot) => resourceNames.has(slot.schedule_id) && slot.remaining > 0 && new Date(slot.ends_at) > now,
  );
  const serviceOptions = (services.data ?? []) as { id: string; name: string }[];
  const barangayOptions = (barangays.data ?? []) as { psgc_code: string; name: string }[];
  await logPatientReads(
    supabase,
    actorId,
    patients.map(([id]) => id),
    "patient_profile.list.read",
  );

  return (
    <>
      <PageHeader title={t("bookings.new")} />
      {open.length === 0 ? (
        <Empty>{t("bookings.noSlots")}</Empty>
      ) : (
        <ActionForm action={bookAtCounter} submitLabel={t("bookings.book")}>
          <input type="hidden" name="facility_id" value={facility.id} />
          <Field label={t("bookings.slot")}>
            <Select name="slot_id" required defaultValue={param(query, "slot") ?? ""}>
              <option value="" disabled>
                {t("common.choose")}
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
                  {` · ${resourceNames.get(slot.schedule_id)} · `}
                  {t("bookings.seatsLeft", { count: slot.remaining })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("bookings.service")}>
            <Select name="service_id" required defaultValue="">
              <option value="" disabled>
                {t("common.choose")}
              </option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </Field>

          {segment === "diagnostics" && (
            <Section title={t("bookings.homeService")}>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="home_service" className="mt-1 size-5" />
                <span>{t("bookings.homeServiceCheck")}</span>
              </label>
              <Field label={t("bookings.homeAddress")} hint={t("bookings.homeAddressHint")}>
                <Input name="home_address" maxLength={300} autoComplete="off" />
              </Field>
              {barangayOptions.length > 0 && (
                <Field label={t("bookings.homeBarangay")}>
                  <Select name="home_barangay_code" defaultValue="">
                    <option value="">{t("common.none")}</option>
                    {barangayOptions.map((barangay) => (
                      <option key={barangay.psgc_code} value={barangay.psgc_code}>
                        {barangay.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t("bookings.homeLandmark")}>
                <Input name="home_landmark" maxLength={200} autoComplete="off" />
              </Field>
            </Section>
          )}

          <CounterPatientFields patients={patients} />
        </ActionForm>
      )}
    </>
  );
}
