import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { CounterPatientFields } from "@/components/provider/counter-patient-fields";
import { PharmacyRequestList, type RequestRow } from "@/components/provider/pharmacy-request-list";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { createReservation, setReservationStatus } from "@/lib/provider/actions/pharmacy";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { knownPatients } from "@/lib/provider/queries";
import { RESERVATION_HOLD_DAYS, RESERVATION_NEXT, type ReservationStatus } from "@/lib/provider/schemas";

const OPTION_LIMIT = 300;
const PATIENT_LIMIT = 200;

type ReservationRow = {
  id: string;
  quantity: number;
  status: ReservationStatus;
  hold_until: string;
  patient_id: string;
  service: { name: string } | null;
  patient: { full_name: string; phone: string | null } | null;
};

// Reservations: a hold for pickup. Not a sale and not a prescription — the
// patient presents theirs at the counter.
export default async function ReservationsPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/reservations">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "reservations");
  const t = await getTranslations("provider.reservations");
  const c = await getTranslations("provider.common");
  const format = await getFormatter();
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);
  const pathname = facilityPath(facility.id, "reservations");

  const [reservations, medicines, patients] = await Promise.all([
    supabase
      .from("reservation")
      .select("id, quantity, status, hold_until, patient_id, service(name), patient:patient_profile(full_name, phone)", {
        count: "exact",
      })
      .eq("facility_id", facility.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
    supabase.from("service").select("id, name").eq("service_type", "medicine").order("name").limit(OPTION_LIMIT),
    knownPatients(supabase, facility.id, PATIENT_LIMIT),
  ]);
  const rows = (reservations.data ?? []) as unknown as ReservationRow[];
  const medicineOptions = (medicines.data ?? []) as { id: string; name: string }[];
  await logPatientReads(
    supabase,
    actorId,
    [...rows.map((row) => row.patient_id), ...patients.map(([id]) => id)],
    "reservation.list.read",
  );

  const list: RequestRow[] = rows.map((row) => ({
    id: row.id,
    title: `${row.patient?.full_name ?? c("none")} · ${row.service?.name ?? c("none")} × ${row.quantity}`,
    detail: [
      t("holdUntil", { date: format.dateTime(new Date(new Date(row.hold_until).getTime() - 1), { dateStyle: "medium" }) }),
      row.patient?.phone,
    ]
      .filter(Boolean)
      .join(" · "),
    statusLabel: t(`statuses.${row.status}`),
    open: RESERVATION_NEXT[row.status].length > 0,
    next: RESERVATION_NEXT[row.status].map((status) => ({
      status,
      label: t(`actions.${status as "ready" | "picked_up" | "cancelled"}`),
      danger: status === "cancelled",
    })),
  }));

  return (
    <>
      <PageHeader title={t("title")} />
      <p className="text-sm text-zinc-600">{t("hint")}</p>

      {list.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <PharmacyRequestList rows={list} facilityId={facility.id} action={setReservationStatus} />
      )}
      <Pagination pathname={pathname} searchParams={query} page={page} total={reservations.count ?? 0} />

      <Section title={t("new")}>
        {medicineOptions.length === 0 ? (
          <Empty>{t("noMedicines")}</Empty>
        ) : (
          <ActionForm action={createReservation} submitLabel={t("new")} resetOnSave>
            <input type="hidden" name="facility_id" value={facility.id} />
            <Field label={t("medicine")}>
              <Select name="service_id" required defaultValue="">
                <option value="" disabled>
                  {c("choose")}
                </option>
                {medicineOptions.map((medicine) => (
                  <option key={medicine.id} value={medicine.id}>
                    {medicine.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("quantity")}>
                <Input name="quantity" type="number" inputMode="numeric" required min={1} max={1000} defaultValue={1} />
              </Field>
              <Field label={t("holdFor")}>
                <Select name="hold_days" defaultValue="2">
                  {RESERVATION_HOLD_DAYS.map((days) => (
                    <option key={days} value={days}>
                      {t("holdDays", { count: days })}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <CounterPatientFields patients={patients} />
          </ActionForm>
        )}
      </Section>
    </>
  );
}
