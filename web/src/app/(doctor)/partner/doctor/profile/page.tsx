import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Facts, Field, Input, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { PrcBadge } from "@/components/admin/prc-badge";
import { addAffiliation, removeAffiliation, updateProfile } from "@/lib/doctor/actions/availability";
import { doctorContext } from "@/lib/doctor/context";
import type { AffiliationRow, AffiliationStatus } from "@/lib/doctor/types";

const FACILITY_OPTIONS_LIMIT = 500;

const AFFILIATION_STYLES: Record<AffiliationStatus, string> = {
  pending: "border-amber-400 bg-amber-100 text-amber-900",
  approved: "border-green-300 bg-green-50 text-green-900",
  rejected: "border-red-400 bg-red-100 text-red-900",
};

export default async function DoctorProfilePage() {
  const { supabase, practitioner } = await doctorContext();
  const t = await getTranslations("doctor.profile");
  const format = await getFormatter();

  const [affiliations, facilities] = await Promise.all([
    supabase
      .from("practitioner_facility")
      .select("id, facility_id, status, facility(name)")
      .eq("practitioner_id", practitioner.id)
      .order("created_at"),
    // Row-level security returns verified facilities only.
    supabase.from("facility").select("id, name").order("name").limit(FACILITY_OPTIONS_LIMIT),
  ]);
  const affiliationRows = (affiliations.data ?? []) as unknown as AffiliationRow[];
  const affiliated = new Set(affiliationRows.map((row) => row.facility_id));
  const options = ((facilities.data ?? []) as { id: string; name: string }[]).filter(
    (facility) => !affiliated.has(facility.id),
  );
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });

  return (
    <>
      <PageHeader title={practitioner.full_name} />

      <Section title={t("prc")}>
        <PrcBadge verified={practitioner.prc_verified_at !== null} live={practitioner.is_live} prominent />
        <Facts
          items={[
            [t("prcNumber"), practitioner.prc_number ?? t("notRecorded")],
            [
              t("licenceExpiry"),
              practitioner.prc_licence_expires_on ? date(practitioner.prc_licence_expires_on) : t("notRecorded"),
            ],
            [
              t("verifiedOn"),
              practitioner.prc_verified_at ? date(practitioner.prc_verified_at) : t("notRecorded"),
            ],
          ]}
        />
        <p className="text-sm text-zinc-600">{t("prcReadOnly")}</p>
      </Section>

      <Section title={t("specialties")}>
        <ActionForm action={updateProfile} submitLabel={t("save")}>
          <Field label={t("specialties")} hint={t("specialtiesHint")}>
            <Input name="specialties" maxLength={500} defaultValue={practitioner.specialties.join(", ")} />
          </Field>
        </ActionForm>
      </Section>

      <Section title={t("affiliations")}>
        <p className="text-sm text-zinc-600">{t("affiliationsHint")}</p>
        {affiliationRows.length === 0 ? (
          <Empty>{t("noAffiliations")}</Empty>
        ) : (
          <ul className={LIST}>
            {affiliationRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 px-3 py-3">
                <span className="font-medium">{row.facility?.name ?? t("facilityUnavailable")}</span>
                <span
                  className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${AFFILIATION_STYLES[row.status]}`}
                >
                  {t(`affiliationStatus.${row.status}`)}
                </span>
                <ActionForm action={removeAffiliation} submitLabel={t("remove")} variant="danger">
                  <input type="hidden" name="facility_id" value={row.facility_id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        {options.length > 0 && (
          <ActionForm action={addAffiliation} submitLabel={t("requestAffiliation")} resetOnSave>
            <Field label={t("clinic")} hint={t("clinicHint")}>
              <Select name="facility_id" required defaultValue="">
                <option value="" disabled>
                  {t("choose")}
                </option>
                {options.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
