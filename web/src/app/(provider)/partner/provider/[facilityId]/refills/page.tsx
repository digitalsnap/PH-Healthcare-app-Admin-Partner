import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { CounterPatientFields } from "@/components/provider/counter-patient-fields";
import { PharmacyRequestList, type RequestRow } from "@/components/provider/pharmacy-request-list";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { createRefillRequest, setRefillStatus } from "@/lib/provider/actions/pharmacy";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { knownPatients } from "@/lib/provider/queries";
import { REFILL_NEXT, type RefillStatus } from "@/lib/provider/schemas";
import { manilaToday } from "@/lib/time/manila";

const OPTION_LIMIT = 300;
const PATIENT_LIMIT = 200;

type RefillRow = {
  id: string;
  status: RefillStatus;
  needed_by: string | null;
  patient_id: string;
  service: { name: string } | null;
  patient: { full_name: string; phone: string | null } | null;
};

// Refill requests for maintenance medicines: accept, prepare, hand over.
export default async function RefillsPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/refills">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "refills");
  const t = await getTranslations("provider.refills");
  const c = await getTranslations("provider.common");
  const format = await getFormatter();
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);
  const pathname = facilityPath(facility.id, "refills");

  const [requests, medicines, patients] = await Promise.all([
    supabase
      .from("refill_request")
      .select("id, status, needed_by, patient_id, service(name), patient:patient_profile(full_name, phone)", {
        count: "exact",
      })
      .eq("facility_id", facility.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
    supabase.from("service").select("id, name").eq("service_type", "medicine").order("name").limit(OPTION_LIMIT),
    knownPatients(supabase, facility.id, PATIENT_LIMIT),
  ]);
  const rows = (requests.data ?? []) as unknown as RefillRow[];
  const medicineOptions = (medicines.data ?? []) as { id: string; name: string }[];
  await logPatientReads(
    supabase,
    actorId,
    [...rows.map((row) => row.patient_id), ...patients.map(([id]) => id)],
    "refill_request.list.read",
  );

  const list: RequestRow[] = rows.map((row) => ({
    id: row.id,
    title: `${row.patient?.full_name ?? c("none")} · ${row.service?.name ?? c("none")}`,
    detail: [
      row.needed_by
        ? t("neededBy", { date: format.dateTime(new Date(`${row.needed_by}T00:00:00+08:00`), { dateStyle: "medium" }) })
        : null,
      row.patient?.phone,
    ]
      .filter(Boolean)
      .join(" · "),
    statusLabel: t(`statuses.${row.status}`),
    open: REFILL_NEXT[row.status].length > 0,
    next: REFILL_NEXT[row.status].map((status) => ({
      status,
      label: t(`actions.${status as "accepted" | "declined" | "ready" | "picked_up" | "cancelled"}`),
      danger: status === "declined" || status === "cancelled",
    })),
  }));

  return (
    <>
      <PageHeader title={t("title")} />
      <p className="text-sm text-zinc-600">{t("hint")}</p>

      {list.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <PharmacyRequestList rows={list} facilityId={facility.id} action={setRefillStatus} />
      )}
      <Pagination pathname={pathname} searchParams={query} page={page} total={requests.count ?? 0} />

      <Section title={t("new")}>
        {medicineOptions.length === 0 ? (
          <Empty>{t("noMedicines")}</Empty>
        ) : (
          <ActionForm action={createRefillRequest} submitLabel={t("new")} resetOnSave>
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
            <Field label={t("neededByLabel")}>
              <Input name="needed_by" type="date" min={manilaToday()} />
            </Field>
            <CounterPatientFields patients={patients} />
          </ActionForm>
        )}
      </Section>
    </>
  );
}
