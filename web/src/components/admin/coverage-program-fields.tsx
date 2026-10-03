import { getTranslations } from "next-intl/server";
import { COVERAGE_PROGRAM_TYPES } from "@/lib/admin/schemas";
import type { CoverageProgramRow } from "@/lib/admin/types";
import { Field, Input, Select } from "./fields";

/** The fields shared by "add program" and "edit program". */
export async function CoverageProgramFields({ program }: { program?: CoverageProgramRow }) {
  const t = await getTranslations("admin");

  return (
    <>
      <Field label={t("coverage.type")}>
        <Select name="program_type" required defaultValue={program?.program_type ?? ""}>
          <option value="" disabled>
            {t("common.choose")}
          </option>
          {COVERAGE_PROGRAM_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`programTypes.${type}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("coverage.name")}>
        <Input name="name" required maxLength={200} defaultValue={program?.name} />
      </Field>
      <Field label={t("coverage.code")} hint={t("coverage.codeHint")}>
        <Input
          name="code"
          required
          pattern="[a-z0-9_]{2,60}"
          maxLength={60}
          autoCapitalize="none"
          defaultValue={program?.code}
        />
      </Field>
      <Field label={t("coverage.rulesVersion")}>
        <Input name="rules_version" required maxLength={60} defaultValue={program?.rules_version} />
      </Field>
      <Field label={t("coverage.sourceUrl")} hint={t("coverage.sourceUrlHint")}>
        <Input
          name="source_url"
          type="url"
          required
          maxLength={500}
          placeholder="https://"
          defaultValue={program?.source_url}
        />
      </Field>
      <Field label={t("coverage.lastReviewed")}>
        <Input name="last_reviewed_on" type="date" defaultValue={program?.last_reviewed_on ?? ""} />
      </Field>
    </>
  );
}
