import { getTranslations } from "next-intl/server";
import { Field, Input, Select } from "@/components/admin/fields";

/**
 * Who the counter booking or reservation is for, and their consent. Used by
 * every assisted flow: no consent tick, no booking — the server enforces it.
 */
export async function CounterPatientFields({ patients }: { patients: Array<[id: string, name: string]> }) {
  const t = await getTranslations("provider.counter");

  return (
    <>
      {patients.length > 0 && (
        <Field label={t("returningPatient")} hint={t("returningPatientHint")}>
          <Select name="patient_id" defaultValue="">
            <option value="">{t("newPatient")}</option>
            {patients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("patientName")}>
        <Input name="full_name" maxLength={200} autoComplete="off" />
      </Field>
      <Field label={t("patientPhone")} hint={t("patientPhoneHint")}>
        <Input name="phone" type="tel" inputMode="tel" maxLength={16} placeholder="09171234567" autoComplete="off" />
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-1 size-5" />
        <span>{t("consent")}</span>
      </label>
    </>
  );
}
