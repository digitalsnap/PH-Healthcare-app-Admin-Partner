import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, LIST, PageHeader } from "@/components/admin/fields";
import { confirmStock } from "@/lib/provider/actions/pharmacy";
import { facilityContext } from "@/lib/provider/context";
import { accreditationStatus } from "@/lib/provider/queries";
import { manilaToday, utcIsoToManilaDate } from "@/lib/time/manila";

const MEDICINE_LIMIT = 300;
const REPORT_LIMIT = 2000;

type Report = { service_id: string; available: boolean; reported_at: string };

// Stock flags for the catalogue's medicines. One tap records "confirmed
// today"; each confirmation is a new row, so the history is kept.
export default async function StockPage({ params }: PageProps<"/partner/provider/[facilityId]/stock">) {
  const { supabase, facility } = await facilityContext((await params).facilityId, "stock");
  const t = await getTranslations("provider.stock");
  const format = await getFormatter();
  const today = manilaToday();

  const [medicines, reports, accreditation] = await Promise.all([
    supabase.from("service").select("id, name").eq("service_type", "medicine").order("name").limit(MEDICINE_LIMIT),
    supabase
      .from("stock_report")
      .select("service_id, available, reported_at")
      .eq("facility_id", facility.id)
      .order("reported_at", { ascending: false })
      .limit(REPORT_LIMIT),
    accreditationStatus(supabase, facility.id),
  ]);
  const medicineRows = (medicines.data ?? []) as { id: string; name: string }[];
  // Newest first, so the first report seen for a medicine is its latest.
  const latest = new Map<string, Report>();
  for (const report of (reports.data ?? []) as Report[]) {
    if (!latest.has(report.service_id)) latest.set(report.service_id, report);
  }

  return (
    <>
      <PageHeader title={t("title")} />
      <span
        className={`inline-flex w-fit rounded border px-3 py-2 text-base font-medium ${
          accreditation.gamot
            ? "border-green-300 bg-green-50 text-green-900"
            : "border-zinc-300 bg-zinc-100 text-zinc-700"
        }`}
      >
        {accreditation.gamot ? t("gamotOn") : t("gamotOff")}
      </span>
      <p className="text-sm text-zinc-600">{t("hint")}</p>

      {medicineRows.length === 0 ? (
        <Empty>{t("noMedicines")}</Empty>
      ) : (
        <ul className={LIST}>
          {medicineRows.map((medicine) => {
            const report = latest.get(medicine.id);
            const confirmedToday = report !== undefined && utcIsoToManilaDate(report.reported_at) === today;
            return (
              <li key={medicine.id} className="flex flex-col gap-2 px-3 py-3">
                <span className="font-medium">{medicine.name}</span>
                <span
                  className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${
                    !report
                      ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                      : !confirmedToday
                        ? "border-amber-400 bg-amber-100 text-amber-900"
                        : report.available
                          ? "border-green-300 bg-green-50 text-green-900"
                          : "border-red-400 bg-red-100 text-red-900"
                  }`}
                >
                  {!report
                    ? t("neverReported")
                    : t(report.available ? "inStockAsOf" : "outOfStockAsOf", {
                        date: confirmedToday
                          ? t("today")
                          : format.dateTime(new Date(report.reported_at), { dateStyle: "medium" }),
                      })}
                </span>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={confirmStock} submitLabel={t("confirmInStock")}>
                    <input type="hidden" name="facility_id" value={facility.id} />
                    <input type="hidden" name="service_id" value={medicine.id} />
                    <input type="hidden" name="available" value="true" />
                  </ActionForm>
                  <ActionForm action={confirmStock} submitLabel={t("confirmOutOfStock")} variant="secondary">
                    <input type="hidden" name="facility_id" value={facility.id} />
                    <input type="hidden" name="service_id" value={medicine.id} />
                    <input type="hidden" name="available" value="false" />
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
