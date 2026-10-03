import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, LIST, PageHeader, ROW_LINK, Section } from "@/components/admin/fields";
import { FreshnessBadge } from "@/components/admin/freshness-badge";
import { decideAffiliation } from "@/lib/admin/actions/practitioners";
import { decideWithdrawal, overrideFileRemoval, retryFileRemoval } from "@/lib/admin/actions/withdrawals";
import { adminContext } from "@/lib/admin/context";
import {
  daysAgoIso,
  percentOf,
  RED_AFTER_DAYS,
  STOCK_REPORT_MAX_AGE_DAYS,
} from "@/lib/admin/freshness";
import type { FacilityRow, PractitionerRow } from "@/lib/admin/types";

const QUEUE_SIZE = 10;

function Tile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded border border-zinc-200 p-4 hover:bg-zinc-50">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-sm text-zinc-600">{label}</span>
    </Link>
  );
}

// Data freshness dashboard: the console's landing page.
export default async function AdminDashboardPage() {
  const { supabase, role } = await adminContext();
  const t = await getTranslations("admin");
  const now = new Date();
  const counted = { count: "exact", head: true } as const;
  const stockCutoff = daysAgoIso(STOCK_REPORT_MAX_AGE_DAYS, now);

  const [total, verified, noPrices, staleStock, unverifiedDoctors, queue, awaitingPrc, affiliationRequests, withdrawals] =
    await Promise.all([
      supabase.from("facility_admin_view").select("id", counted),
      supabase
        .from("facility_admin_view")
        .select("id", counted)
        .gte("last_verified_at", daysAgoIso(RED_AFTER_DAYS, now)),
      supabase.from("facility_admin_view").select("id", counted).eq("price_item_count", 0),
      supabase
        .from("facility_admin_view")
        .select("id", counted)
        .eq("facility_type", "pharmacy")
        .or(`last_stock_report_at.is.null,last_stock_report_at.lt.${stockCutoff}`),
      supabase.from("practitioner").select("id", counted).is("prc_verified_at", null),
      // What to verify next: never-verified first, then the oldest.
      supabase
        .from("facility_admin_view")
        .select("id, name, facility_type, municipality_name, last_verified_at")
        .order("last_verified_at", { ascending: true, nullsFirst: true })
        .limit(QUEUE_SIZE),
      supabase
        .from("practitioner")
        .select("id, full_name, prc_number, verification_requested_at")
        .is("prc_verified_at", null)
        // Doctors who asked to be verified come first.
        .order("verification_requested_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(QUEUE_SIZE),
      supabase
        .from("practitioner_facility")
        .select("id, requested_at, practitioner(id, full_name), facility(id, name)", { count: "exact" })
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(QUEUE_SIZE),
      // Requested, or approved with the file still to delete. No patient
      // details are read: only what is needed to decide.
      supabase
        .from("vault_document")
        .select(
          "id, document_type, withdrawal_status, withdrawal_reason, withdrawal_requested_at, facility(name)",
          { count: "exact" },
        )
        .or("withdrawal_status.eq.requested,and(withdrawal_status.eq.approved,file_removed_at.is.null)")
        .order("withdrawal_requested_at", { ascending: true })
        .limit(QUEUE_SIZE),
    ]);

  const totalCount = total.count ?? 0;
  const verifiedCount = verified.count ?? 0;
  const queueRows = (queue.data ?? []) as Pick<
    FacilityRow,
    "id" | "name" | "facility_type" | "municipality_name" | "last_verified_at"
  >[];
  const prcRows = (awaitingPrc.data ?? []) as (Pick<PractitionerRow, "id" | "full_name" | "prc_number"> & {
    verification_requested_at: string | null;
  })[];
  const requestRows = (affiliationRequests.data ?? []) as unknown as {
    id: string;
    requested_at: string;
    practitioner: { id: string; full_name: string } | null;
    facility: { id: string; name: string } | null;
  }[];
  const withdrawalRows = (withdrawals.data ?? []) as unknown as {
    id: string;
    document_type: "lab_result" | "imaging_result" | "prescription" | "consult_summary" | "other";
    withdrawal_status: "requested" | "approved";
    withdrawal_reason: "wrong_patient" | "wrong_file" | "duplicate" | "other";
    withdrawal_requested_at: string;
    facility: { name: string } | null;
  }[];
  const format = await getFormatter();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });

  return (
    <>
      <PageHeader title={t("dashboard.title")} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile
          href="/admin/facilities"
          value={`${percentOf(verifiedCount, totalCount)}%`}
          label={t("dashboard.verifiedShare", { verified: verifiedCount, total: totalCount })}
        />
        <Tile
          href="/admin/facilities?missing=prices"
          value={String(noPrices.count ?? 0)}
          label={t("dashboard.noPrices")}
        />
        <Tile
          href="/admin/facilities?missing=stock"
          value={String(staleStock.count ?? 0)}
          label={t("dashboard.staleStock")}
        />
        <Tile
          href="/admin/practitioners?prc=unverified"
          value={String(unverifiedDoctors.count ?? 0)}
          label={t("dashboard.unverifiedDoctors")}
        />
      </div>

      <Section title={t("dashboard.workQueue")}>
        {queueRows.length === 0 ? (
          <Empty>{t("dashboard.workQueueEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {queueRows.map((facility) => (
              <li key={facility.id}>
                <Link href={`/admin/facilities/${facility.id}`} className={ROW_LINK}>
                  <span className="font-medium">{facility.name}</span>
                  <span className="text-sm text-zinc-600">
                    {t(`facilityTypes.${facility.facility_type}`)}
                    {facility.municipality_name ? ` · ${facility.municipality_name}` : ""}
                  </span>
                  <FreshnessBadge lastVerifiedAt={facility.last_verified_at} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("dashboard.affiliationRequests", { count: affiliationRequests.count ?? 0 })}>
        {requestRows.length === 0 ? (
          <Empty>{t("dashboard.affiliationRequestsEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {requestRows.map((request) => (
              <li key={request.id} className="flex flex-col gap-2 px-3 py-3">
                <span className="font-medium">
                  {request.practitioner?.full_name} → {request.facility?.name}
                </span>
                <span className="text-sm text-zinc-600">
                  {t("dashboard.requestedOn", { date: date(request.requested_at) })}
                </span>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={decideAffiliation} submitLabel={t("dashboard.approve")}>
                    <input type="hidden" name="id" value={request.id} />
                    <input type="hidden" name="decision" value="approved" />
                  </ActionForm>
                  <ActionForm action={decideAffiliation} submitLabel={t("dashboard.reject")} variant="danger">
                    <input type="hidden" name="id" value={request.id} />
                    <input type="hidden" name="decision" value="rejected" />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("dashboard.withdrawals", { count: withdrawals.count ?? 0 })}>
        <p className="text-sm text-zinc-600">{t("dashboard.withdrawalsHint")}</p>
        {withdrawalRows.length === 0 ? (
          <Empty>{t("dashboard.withdrawalsEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {withdrawalRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 px-3 py-3">
                <span className="font-medium">
                  {t(`dashboard.documentTypes.${row.document_type}`)} · {row.facility?.name}
                </span>
                <span className="text-sm text-zinc-600">
                  {t(`dashboard.withdrawalReasons.${row.withdrawal_reason}`)} ·{" "}
                  {t("dashboard.requestedOn", { date: date(row.withdrawal_requested_at) })}
                </span>
                {row.withdrawal_status === "requested" ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={decideWithdrawal} submitLabel={t("dashboard.approveWithdrawal")} variant="danger">
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="decision" value="approved" />
                    </ActionForm>
                    <ActionForm action={decideWithdrawal} submitLabel={t("dashboard.rejectWithdrawal")} variant="secondary">
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="decision" value="rejected" />
                    </ActionForm>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-red-800">{t("dashboard.removalPending")}</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={retryFileRemoval} submitLabel={t("dashboard.retryRemoval")} variant="danger">
                        <input type="hidden" name="id" value={row.id} />
                      </ActionForm>
                      {role === "admin" && (
                        <ActionForm
                          action={overrideFileRemoval}
                          submitLabel={t("dashboard.overrideRemoval")}
                          variant="secondary"
                        >
                          <input type="hidden" name="id" value={row.id} />
                          <label className="flex items-start gap-3 text-sm">
                            <input type="checkbox" name="confirm" required className="mt-1 size-5" />
                            <span>{t("dashboard.overrideConfirm")}</span>
                          </label>
                        </ActionForm>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("dashboard.awaitingPrc")}>
        {prcRows.length === 0 ? (
          <Empty>{t("dashboard.awaitingPrcEmpty")}</Empty>
        ) : (
          <ul className={LIST}>
            {prcRows.map((practitioner) => (
              <li key={practitioner.id}>
                <Link href={`/admin/practitioners/${practitioner.id}`} className={ROW_LINK}>
                  <span className="font-medium">{practitioner.full_name}</span>
                  <span className="text-sm text-zinc-600">
                    {practitioner.prc_number ?? t("practitioners.noPrcNumber")}
                  </span>
                  {practitioner.verification_requested_at && (
                    <span className="w-fit rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {t("dashboard.requestedVerification", { date: date(practitioner.verification_requested_at) })}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
