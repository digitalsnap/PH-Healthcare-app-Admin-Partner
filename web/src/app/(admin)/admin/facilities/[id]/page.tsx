import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import {
  Empty,
  Facts,
  Field,
  Input,
  LINK_BUTTON,
  LIST,
  PageHeader,
  Section,
  Select,
} from "@/components/admin/fields";
import { FreshnessBadge } from "@/components/admin/freshness-badge";
import {
  addAccreditation,
  addPrice,
  deleteAccreditation,
  deletePrice,
  recordFacilityVerification,
  setFacilityStatus,
} from "@/lib/admin/actions/facilities";
import { adminContext } from "@/lib/admin/context";
import { idSchema, SETTABLE_STATUSES, WEEKDAYS } from "@/lib/admin/schemas";
import { manilaToday } from "@/lib/time/manila";
import type {
  AccreditationRow,
  CoverageProgramRow,
  FacilityRow,
  PriceRow,
  ServiceRow,
} from "@/lib/admin/types";
import { PRICE_SOURCES } from "@/lib/coverage";
import { centavos, formatRange, range } from "@/lib/money";

const SUBLIST_LIMIT = 100;

export default async function FacilityPage({ params }: PageProps<"/admin/facilities/[id]">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data } = await supabase.from("facility_admin_view").select("*").eq("id", id.data).maybeSingle();
  if (!data) notFound();
  const facility = data as FacilityRow;

  const [prices, accreditations, services, programs] = await Promise.all([
    supabase
      .from("price_item")
      .select(
        "id, amount_min_centavos, amount_max_centavos, source, observed_at, report_count, service(name, service_type)",
      )
      .eq("facility_id", facility.id)
      .order("observed_at", { ascending: false })
      .limit(SUBLIST_LIMIT),
    supabase
      .from("accreditation")
      .select("id, valid_from, valid_to, source, source_url, coverage_program(name, program_type)")
      .eq("facility_id", facility.id)
      .order("valid_from", { ascending: false })
      .limit(SUBLIST_LIMIT),
    supabase.from("service").select("id, service_type, name").order("name").limit(500),
    supabase.from("coverage_program").select("id, name, program_type").order("name").limit(500),
  ]);
  const priceRows = (prices.data ?? []) as unknown as PriceRow[];
  const accreditationRows = (accreditations.data ?? []) as unknown as AccreditationRow[];
  const serviceOptions = (services.data ?? []) as Pick<ServiceRow, "id" | "service_type" | "name">[];
  const programOptions = (programs.data ?? []) as Pick<CoverageProgramRow, "id" | "name" | "program_type">[];

  const today = manilaToday();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const isCurrent = (row: AccreditationRow) =>
    row.valid_from <= today && (row.valid_to === null || row.valid_to >= today);
  const accredited = (type: "philhealth_yakap" | "gamot") =>
    accreditationRows.some((row) => row.coverage_program?.program_type === type && isCurrent(row));

  const hours = WEEKDAYS.filter((day) => facility.hours[String(day)]).map(
    (day) =>
      `${t(`weekdays.${day}`)} ${facility.hours[String(day)].open}–${facility.hours[String(day)].close}`,
  );

  return (
    <>
      <PageHeader
        title={facility.name}
        action={
          <Link href={`/admin/facilities/${facility.id}/edit`} className={LINK_BUTTON}>
            {t("common.edit")}
          </Link>
        }
      />
      <FreshnessBadge lastVerifiedAt={facility.last_verified_at} prominent />

      <Facts
        items={[
          [t("facilities.type"), t(`facilityTypes.${facility.facility_type}`)],
          [t("facilities.status"), t(`verificationStatus.${facility.verification_status}`)],
          [t("facilities.municipality"), facility.municipality_name ?? t("common.none")],
          [t("facilities.barangay"), facility.barangay_name ?? t("common.none")],
          [t("facilities.address"), facility.address_line ?? t("common.none")],
          [t("facilities.phone"), facility.phone ?? t("common.none")],
          [
            t("facilities.coordinates"),
            facility.latitude !== null && facility.longitude !== null
              ? `${facility.latitude}, ${facility.longitude}`
              : t("common.none"),
          ],
          [t("facilities.hours"), hours.length > 0 ? hours.join(" · ") : t("common.none")],
          [
            t("facilities.licences"),
            facility.licences.length > 0
              ? facility.licences
                  .map(
                    (licence) =>
                      `${t(`licenceKinds.${licence.kind}`)} ${licence.number}` +
                      (licence.expires_on ? ` (${t("facilities.expires", { date: date(licence.expires_on) })})` : ""),
                  )
                  .join(" · ")
              : t("common.none"),
          ],
          [t("facilities.yakap"), accredited("philhealth_yakap") ? t("common.yes") : t("common.no")],
          [t("facilities.gamot"), accredited("gamot") ? t("common.yes") : t("common.no")],
        ]}
      />

      <Section title={t("facilities.verification")}>
        <p className="text-sm text-zinc-600">{t("facilities.verificationHint")}</p>
        <ActionForm action={recordFacilityVerification} submitLabel={t("facilities.markVerified")}>
          <input type="hidden" name="id" value={facility.id} />
        </ActionForm>
        <ActionForm action={setFacilityStatus} submitLabel={t("facilities.setStatus")} variant="secondary">
          <input type="hidden" name="id" value={facility.id} />
          <Field label={t("facilities.status")}>
            <Select
              name="verification_status"
              defaultValue={
                SETTABLE_STATUSES.find((status) => status === facility.verification_status) ?? "pending"
              }
            >
              {SETTABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`verificationStatus.${status}`)}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Section>

      <Section title={t("prices.title")}>
        {priceRows.length === 0 ? (
          <Empty>{t("prices.empty")}</Empty>
        ) : (
          <ul className={LIST}>
            {priceRows.map((price) => (
              <li key={price.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                <span className="font-medium">{price.service?.name ?? t("common.none")}</span>
                <span>
                  {formatRange(
                    range(centavos(price.amount_min_centavos), centavos(price.amount_max_centavos)),
                  )}
                </span>
                <span className="text-zinc-600">
                  {price.source === "patient_reported"
                    ? t("prices.patientReported", {
                        count: price.report_count ?? 1,
                        date: date(price.observed_at),
                      })
                    : t("prices.sourceOn", {
                        source: t(`priceSources.${price.source}`),
                        date: date(price.observed_at),
                      })}
                </span>
                <ActionForm action={deletePrice} submitLabel={t("common.remove")} variant="danger">
                  <input type="hidden" name="id" value={price.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-sm font-semibold">{t("prices.add")}</h3>
        {serviceOptions.length === 0 ? (
          <Empty>{t("prices.noServices")}</Empty>
        ) : (
          <ActionForm action={addPrice} submitLabel={t("prices.add")} resetOnSave>
            <input type="hidden" name="facility_id" value={facility.id} />
            <Field label={t("prices.service")}>
              <Select name="service_id" required defaultValue="">
                <option value="" disabled>
                  {t("common.choose")}
                </option>
                {serviceOptions.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} ({t(`serviceTypes.${service.service_type}`)})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("prices.min")}>
                <Input name="amount_min" inputMode="decimal" required placeholder="350.00" />
              </Field>
              <Field label={t("prices.max")}>
                <Input name="amount_max" inputMode="decimal" required placeholder="500.00" />
              </Field>
            </div>
            <Field label={t("prices.source")}>
              <Select name="source" required defaultValue="">
                <option value="" disabled>
                  {t("common.choose")}
                </option>
                {PRICE_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {t(`priceSources.${source}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("prices.observedOn")}>
              <Input name="observed_on" type="date" required max={today} />
            </Field>
            <Field label={t("prices.reportCount")} hint={t("prices.reportCountHint")}>
              <Input name="report_count" type="number" inputMode="numeric" min={1} />
            </Field>
          </ActionForm>
        )}
      </Section>

      <Section title={t("accreditations.title")}>
        {accreditationRows.length === 0 ? (
          <Empty>{t("accreditations.empty")}</Empty>
        ) : (
          <ul className={LIST}>
            {accreditationRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                <span className="font-medium">
                  {row.coverage_program?.name ?? t("common.none")}
                  {` · ${isCurrent(row) ? t("accreditations.current") : t("accreditations.notCurrent")}`}
                </span>
                <span>
                  {row.valid_to
                    ? t("accreditations.validRange", { from: date(row.valid_from), to: date(row.valid_to) })
                    : t("accreditations.validFrom", { from: date(row.valid_from) })}
                </span>
                <span className="text-zinc-600">
                  {t("accreditations.sourceLabel", { source: row.source })}
                  {row.source_url && (
                    <>
                      {" · "}
                      <a href={row.source_url} rel="noreferrer noopener" target="_blank" className="underline">
                        {t("common.sourceLink")}
                      </a>
                    </>
                  )}
                </span>
                <ActionForm action={deleteAccreditation} submitLabel={t("common.remove")} variant="danger">
                  <input type="hidden" name="id" value={row.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-sm font-semibold">{t("accreditations.add")}</h3>
        {programOptions.length === 0 ? (
          <Empty>{t("accreditations.noPrograms")}</Empty>
        ) : (
          <ActionForm action={addAccreditation} submitLabel={t("accreditations.add")} resetOnSave>
            <input type="hidden" name="facility_id" value={facility.id} />
            <Field label={t("accreditations.program")}>
              <Select name="coverage_program_id" required defaultValue="">
                <option value="" disabled>
                  {t("common.choose")}
                </option>
                {programOptions.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name} ({t(`programTypes.${program.program_type}`)})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("accreditations.validFromLabel")}>
                <Input name="valid_from" type="date" required />
              </Field>
              <Field label={t("accreditations.validToLabel")}>
                <Input name="valid_to" type="date" />
              </Field>
            </div>
            <Field label={t("accreditations.source")}>
              <Input name="source" required maxLength={200} />
            </Field>
            <Field label={t("accreditations.sourceUrl")}>
              <Input name="source_url" type="url" maxLength={500} placeholder="https://" />
            </Field>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
