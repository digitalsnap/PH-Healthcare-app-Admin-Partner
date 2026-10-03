import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import { logPatientReads } from "@/lib/doctor/audit";
import { APPOINTMENT_COLUMNS, type AppointmentRow } from "@/lib/doctor/types";
import { deliverResult, requestWithdrawal } from "@/lib/provider/actions/results";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import {
  RESULT_MAX_BYTES,
  RESULT_MIME_TYPES,
  RESULT_TYPES,
  WITHDRAWAL_REASONS,
  type WithdrawalStatus,
} from "@/lib/provider/schemas";
import { addDays } from "@/lib/scheduling/generate";
import { manilaDateToUtcIso, manilaToday } from "@/lib/time/manila";

/** Results are delivered for visits in the last 30 days. */
const VISIT_WINDOW_DAYS = 30;
const VISIT_LIMIT = 200;

type DocumentRow = {
  id: string;
  document_type: (typeof RESULT_TYPES)[number];
  released_at: string;
  appointment_id: string | null;
  patient_id: string;
  withdrawal_status: WithdrawalStatus | null;
};

// Result delivery: the branch releases a file to the patient's health vault.
// The platform stores and hands over the document; it does not read it.
export default async function ResultsPage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/results">) {
  const { supabase, actorId, facility } = await facilityContext((await params).facilityId, "results");
  const t = await getTranslations("provider.results");
  const format = await getFormatter();
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);
  const pathname = facilityPath(facility.id, "results");

  const [visits, documents] = await Promise.all([
    supabase
      .from("practitioner_appointment_view")
      .select(APPOINTMENT_COLUMNS)
      .eq("facility_id", facility.id)
      .in("status", ["checked_in", "seen", "completed"])
      .gte("starts_at", manilaDateToUtcIso(addDays(manilaToday(), -VISIT_WINDOW_DAYS)))
      .order("starts_at", { ascending: false })
      .limit(VISIT_LIMIT),
    supabase
      .from("vault_document")
      .select("id, document_type, released_at, appointment_id, patient_id, withdrawal_status", { count: "exact" })
      .eq("facility_id", facility.id)
      .order("released_at", { ascending: false })
      .order("id")
      .range(from, to),
  ]);
  const visitRows = (visits.data ?? []) as unknown as AppointmentRow[];
  const documentRows = (documents.data ?? []) as DocumentRow[];
  const names = new Map(visitRows.map((visit) => [visit.id, visit.patient_name]));
  await logPatientReads(
    supabase,
    actorId,
    [...visitRows.map((visit) => visit.patient_id), ...documentRows.map((row) => row.patient_id)],
    "vault_document.list.read",
  );
  const dateTime = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title={t("title")} />

      <Section title={t("deliver")}>
        <p className="text-sm text-zinc-600">{t("deliverHint")}</p>
        {visitRows.length === 0 ? (
          <Empty>{t("noVisits")}</Empty>
        ) : (
          <ActionForm action={deliverResult} submitLabel={t("deliver")} resetOnSave>
            <input type="hidden" name="facility_id" value={facility.id} />
            <Field label={t("visit")}>
              <Select name="appointment_id" required defaultValue="">
                <option value="" disabled>
                  {t("choose")}
                </option>
                {visitRows.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {visit.patient_name} · {dateTime(visit.starts_at)}
                    {visit.service_name ? ` · ${visit.service_name}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("type")}>
              <Select name="document_type" defaultValue="lab_result">
                {RESULT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("file")} hint={t("fileHint", { megabytes: RESULT_MAX_BYTES / (1024 * 1024) })}>
              <input
                type="file"
                name="file"
                required
                accept={RESULT_MIME_TYPES.join(",")}
                className="min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base font-normal"
              />
            </Field>
          </ActionForm>
        )}
      </Section>

      <Section title={t("delivered")}>
        {documentRows.length === 0 ? (
          <Empty>{t("noneDelivered")}</Empty>
        ) : (
          <ul className={LIST}>
            {documentRows.map((document) => (
              <li key={document.id} className="flex flex-col gap-1 px-3 py-3 text-sm">
                <span className="font-medium">
                  {t(`types.${document.document_type}`)}
                  {document.appointment_id && names.has(document.appointment_id)
                    ? ` · ${names.get(document.appointment_id)}`
                    : ""}
                </span>
                <span className="text-zinc-600">{t("releasedOn", { date: dateTime(document.released_at) })}</span>
                {document.withdrawal_status && (
                  <span
                    className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${
                      document.withdrawal_status === "rejected"
                        ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                        : "border-amber-400 bg-amber-100 text-amber-900"
                    }`}
                  >
                    {t(`withdrawal.statuses.${document.withdrawal_status}`)}
                  </span>
                )}
                {document.withdrawal_status !== "approved" && (
                  // A fresh, short-lived signed link each time; the file is never public.
                  <a
                    href={`${pathname}/${document.id}/file`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-h-11 items-center underline"
                  >
                    {t("open")}
                  </a>
                )}
                {document.withdrawal_status === null && (
                  <ActionForm action={requestWithdrawal} submitLabel={t("withdrawal.request")} variant="danger">
                    <input type="hidden" name="facility_id" value={facility.id} />
                    <input type="hidden" name="id" value={document.id} />
                    <Field label={t("withdrawal.reason")} hint={t("withdrawal.hint")}>
                      <Select name="withdrawal_reason" required defaultValue="">
                        <option value="" disabled>
                          {t("choose")}
                        </option>
                        {WITHDRAWAL_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {t(`withdrawal.reasons.${reason}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination pathname={pathname} searchParams={query} page={page} total={documents.count ?? 0} />
      </Section>
    </>
  );
}
