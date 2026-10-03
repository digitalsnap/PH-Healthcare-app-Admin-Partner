import { getTranslations } from "next-intl/server";
import { FACILITY_TYPES, LICENCE_KINDS, LICENCE_ROWS, WEEKDAYS } from "@/lib/admin/schemas";
import type { FacilityRow, LocationOption, OrganizationOption } from "@/lib/admin/types";
import { Field, Input, Section, Select } from "./fields";

/** The fields shared by "new facility" and "edit facility". */
export async function FacilityFields({
  facility,
  municipalities,
  barangays,
  organizations,
}: {
  facility?: FacilityRow;
  municipalities: LocationOption[];
  /** Barangays of the facility's municipality; only known once it is saved. */
  barangays?: LocationOption[];
  /** The organization that owns the facility; its staff manage it in the provider portal. */
  organizations: OrganizationOption[];
}) {
  const t = await getTranslations("admin");
  const licences = facility?.licences ?? [];

  return (
    <>
      <Field label={t("facilities.name")}>
        <Input name="name" required maxLength={200} defaultValue={facility?.name} />
      </Field>
      <Field label={t("facilities.type")}>
        <Select name="facility_type" required defaultValue={facility?.facility_type ?? ""}>
          <option value="" disabled>
            {t("common.choose")}
          </option>
          {FACILITY_TYPES.map((option) => (
            <option key={option} value={option}>
              {t(`facilityTypes.${option}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("facilities.municipality")}>
        <Select name="municipality_code" required defaultValue={facility?.municipality_code ?? ""}>
          <option value="" disabled>
            {t("common.choose")}
          </option>
          {municipalities.map((option) => (
            <option key={option.psgc_code} value={option.psgc_code}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      {barangays ? (
        <Field label={t("facilities.barangay")} hint={t("facilities.barangayHint")}>
          <Select name="barangay_code" defaultValue={facility?.barangay_code ?? ""}>
            <option value="">{t("common.none")}</option>
            {barangays.map((option) => (
              <option key={option.psgc_code} value={option.psgc_code}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-sm text-zinc-600">{t("facilities.barangayAfterSave")}</p>
      )}
      <Field label={t("facilities.organization")} hint={t("facilities.organizationHint")}>
        <Select name="parent_org_id" defaultValue={facility?.parent_org_id ?? ""}>
          <option value="">{t("common.none")}</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("facilities.address")}>
        <Input name="address_line" maxLength={300} defaultValue={facility?.address_line ?? ""} />
      </Field>
      <Field label={t("facilities.phone")}>
        <Input name="phone" type="tel" maxLength={20} defaultValue={facility?.phone ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("facilities.latitude")}>
          <Input
            name="latitude"
            inputMode="decimal"
            defaultValue={facility?.latitude ?? ""}
            placeholder="13.7565"
          />
        </Field>
        <Field label={t("facilities.longitude")}>
          <Input
            name="longitude"
            inputMode="decimal"
            defaultValue={facility?.longitude ?? ""}
            placeholder="121.0583"
          />
        </Field>
      </div>

      <Section title={t("facilities.hours")}>
        <p className="text-sm text-zinc-600">{t("facilities.hoursHint")}</p>
        {WEEKDAYS.map((day) => (
          <div key={day} className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2 text-sm">
            <span>{t(`weekdays.${day}`)}</span>
            <Input
              name={`hours_${day}_open`}
              type="time"
              aria-label={t("facilities.opens", { day: t(`weekdays.${day}`) })}
              defaultValue={facility?.hours[String(day)]?.open ?? ""}
            />
            <Input
              name={`hours_${day}_close`}
              type="time"
              aria-label={t("facilities.closes", { day: t(`weekdays.${day}`) })}
              defaultValue={facility?.hours[String(day)]?.close ?? ""}
            />
          </div>
        ))}
      </Section>

      <Section title={t("facilities.licences")}>
        {Array.from({ length: LICENCE_ROWS }, (_, row) => (
          <div key={row} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select
              name={`licence_${row}_kind`}
              aria-label={t("facilities.licenceKind")}
              defaultValue={licences[row]?.kind ?? ""}
            >
              <option value="">{t("common.none")}</option>
              {LICENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`licenceKinds.${kind}`)}
                </option>
              ))}
            </Select>
            <Input
              name={`licence_${row}_number`}
              maxLength={100}
              placeholder={t("facilities.licenceNumber")}
              aria-label={t("facilities.licenceNumber")}
              defaultValue={licences[row]?.number ?? ""}
            />
            <Input
              name={`licence_${row}_expires_on`}
              type="date"
              aria-label={t("facilities.licenceExpiry")}
              defaultValue={licences[row]?.expires_on ?? ""}
            />
          </div>
        ))}
      </Section>
    </>
  );
}
