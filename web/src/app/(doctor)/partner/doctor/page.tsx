import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Empty, PageHeader, PRIMARY_LINK_BUTTON, Section } from "@/components/admin/fields";
import { PrcBadge } from "@/components/admin/prc-badge";
import { AppointmentList } from "@/components/doctor/appointment-list";
import { logPatientReads } from "@/lib/doctor/audit";
import { doctorContext } from "@/lib/doctor/context";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

const TODAY_LIMIT = 100;

// The doctor's landing page: today's appointments.
export default async function DoctorHomePage() {
  const { supabase, actorId, practitioner } = await doctorContext();
  const t = await getTranslations("doctor");
  const today = manilaToday();

  const { data } = await supabase
    .from("practitioner_appointment_view")
    .select(APPOINTMENT_COLUMNS)
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
    "appointment.list.read",
  );

  const verified = practitioner.prc_verified_at !== null;

  return (
    <>
      <PageHeader
        title={t("home.title", { name: practitioner.full_name })}
        action={
          <Link href="/partner/doctor/appointments/new" className={PRIMARY_LINK_BUTTON}>
            {t("walkIn.title")}
          </Link>
        }
      />
      {!verified && (
        <div className="flex flex-col gap-2">
          <PrcBadge verified={false} live={false} prominent />
          <p className="text-sm text-zinc-600">{t("home.notVerified")}</p>
        </div>
      )}

      <Section title={t("home.today")}>
        {appointments.length === 0 ? (
          <Empty>{t("home.noneToday")}</Empty>
        ) : (
          <AppointmentList appointments={appointments} showDate={false} />
        )}
      </Section>
    </>
  );
}
