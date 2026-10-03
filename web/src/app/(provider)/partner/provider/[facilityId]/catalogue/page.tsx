import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import type { ServiceType } from "@/lib/admin/schemas";
import { centavos, formatRange, range } from "@/lib/money";
import {
  addCatalogueService,
  addProviderPrice,
  deletePrep,
  deleteProviderPrice,
  savePrep,
} from "@/lib/provider/actions/facility";
import { facilityContext } from "@/lib/provider/context";
import type { Segment } from "@/lib/provider/segments";

const LIMIT = 500;

/** The kinds of service each portal lists and prices. */
const SERVICE_TYPES_FOR: Record<Segment, readonly ServiceType[]> = {
  clinic: ["consult", "procedure", "lab_test"],
  diagnostics: ["lab_test", "imaging"],
  pharmacy: ["medicine"],
};

type PriceRow = {
  id: string;
  amount_min_centavos: number;
  amount_max_centavos: number;
  observed_at: string;
  service: { name: string; service_type: ServiceType } | null;
};
type PrepRow = {
  id: string;
  locale: "en" | "fil";
  instructions: string;
  fasting_hours: number | null;
  service: { name: string } | null;
};

// What the facility offers and what it charges. A price entered here is the
// facility's own, so it is labelled "confirmed by facility" with today's date.
export default async function CataloguePage({ params }: PageProps<"/partner/provider/[facilityId]/catalogue">) {
  const { supabase, facility, segment } = await facilityContext((await params).facilityId, "catalogue");
  const t = await getTranslations("provider");
  const serviceTypes = await getTranslations("admin.serviceTypes");
  const format = await getFormatter();
  const allowed = SERVICE_TYPES_FOR[segment];

  const [prices, services, prep] = await Promise.all([
    supabase
      .from("price_item")
      .select("id, amount_min_centavos, amount_max_centavos, observed_at, service(name, service_type)")
      .eq("facility_id", facility.id)
      .order("observed_at", { ascending: false })
      .limit(LIMIT),
    supabase.from("service").select("id, name, service_type").in("service_type", allowed).order("name").limit(LIMIT),
    segment === "diagnostics"
      ? supabase
          .from("service_prep")
          .select("id, locale, instructions, fasting_hours, service(name)")
          .eq("facility_id", facility.id)
          .limit(LIMIT)
      : Promise.resolve({ data: [] }),
  ]);
  const priceRows = (prices.data ?? []) as unknown as PriceRow[];
  const serviceOptions = (services.data ?? []) as { id: string; name: string; service_type: ServiceType }[];
  const prepRows = (prep.data ?? []) as unknown as PrepRow[];
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });

  const serviceSelect = (
    <Select name="service_id" required defaultValue="">
      <option value="" disabled>
        {t("common.choose")}
      </option>
      {serviceOptions.map((service) => (
        <option key={service.id} value={service.id}>
          {service.name} ({serviceTypes(service.service_type)})
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <PageHeader title={t("catalogue.title")} />

      <Section title={t("catalogue.prices")}>
        {priceRows.length === 0 ? (
          <Empty>{t("catalogue.noPrices")}</Empty>
        ) : (
          <ul className={LIST}>
            {priceRows.map((price) => (
              <li key={price.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                <span className="font-medium">{price.service?.name ?? t("common.none")}</span>
                <span>
                  {formatRange(range(centavos(price.amount_min_centavos), centavos(price.amount_max_centavos)))}
                </span>
                <span className="text-zinc-600">{t("catalogue.confirmedOn", { date: date(price.observed_at) })}</span>
                <ActionForm action={deleteProviderPrice} submitLabel={t("common.remove")} variant="danger">
                  <input type="hidden" name="facility_id" value={facility.id} />
                  <input type="hidden" name="id" value={price.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-sm font-semibold">{t("catalogue.addPrice")}</h3>
        <p className="text-sm text-zinc-600">{t("catalogue.addPriceHint")}</p>
        {serviceOptions.length === 0 ? (
          <Empty>{t("catalogue.noServices")}</Empty>
        ) : (
          <ActionForm action={addProviderPrice} submitLabel={t("catalogue.addPrice")} resetOnSave>
            <input type="hidden" name="facility_id" value={facility.id} />
            <Field label={t("catalogue.service")}>{serviceSelect}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("catalogue.min")}>
                <Input name="amount_min" inputMode="decimal" required placeholder="350.00" />
              </Field>
              <Field label={t("catalogue.max")}>
                <Input name="amount_max" inputMode="decimal" required placeholder="500.00" />
              </Field>
            </div>
          </ActionForm>
        )}
      </Section>

      {segment === "diagnostics" && (
        <Section title={t("catalogue.prep")}>
          <p className="text-sm text-zinc-600">{t("catalogue.prepHint")}</p>
          {prepRows.length === 0 ? (
            <Empty>{t("catalogue.noPrep")}</Empty>
          ) : (
            <ul className={LIST}>
              {prepRows.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                  <span className="font-medium">
                    {row.service?.name ?? t("common.none")} · {t(`catalogue.locales.${row.locale}`)}
                  </span>
                  <span>{row.instructions}</span>
                  {row.fasting_hours !== null && (
                    <span className="text-zinc-600">{t("catalogue.fasting", { hours: row.fasting_hours })}</span>
                  )}
                  <ActionForm action={deletePrep} submitLabel={t("common.remove")} variant="danger">
                    <input type="hidden" name="facility_id" value={facility.id} />
                    <input type="hidden" name="id" value={row.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          {serviceOptions.length > 0 && (
            <ActionForm action={savePrep} submitLabel={t("catalogue.savePrep")} resetOnSave>
              <input type="hidden" name="facility_id" value={facility.id} />
              <Field label={t("catalogue.service")}>{serviceSelect}</Field>
              <Field label={t("catalogue.language")}>
                <Select name="locale" defaultValue="fil">
                  <option value="fil">{t("catalogue.locales.fil")}</option>
                  <option value="en">{t("catalogue.locales.en")}</option>
                </Select>
              </Field>
              <Field label={t("catalogue.instructions")}>
                <Input name="instructions" required maxLength={1000} />
              </Field>
              <Field label={t("catalogue.fastingHours")} hint={t("catalogue.fastingHoursHint")}>
                <Input name="fasting_hours" type="number" inputMode="numeric" min={0} max={72} />
              </Field>
            </ActionForm>
          )}
        </Section>
      )}

      <Section title={t("catalogue.addService")}>
        <p className="text-sm text-zinc-600">{t("catalogue.addServiceHint")}</p>
        <ActionForm action={addCatalogueService} submitLabel={t("catalogue.addService")} resetOnSave>
          <input type="hidden" name="facility_id" value={facility.id} />
          <Field label={t("catalogue.serviceType")}>
            <Select name="service_type" required defaultValue={allowed[0]}>
              {allowed.map((type) => (
                <option key={type} value={type}>
                  {serviceTypes(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("catalogue.serviceName")}>
            <Input name="name" required maxLength={200} />
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
