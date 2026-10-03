import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { CoverageProgramFields } from "@/components/admin/coverage-program-fields";
import { Empty, LIST, PageHeader, ROW_LINK, Section } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { createCoverageProgram } from "@/lib/admin/actions/catalogue";
import { adminContext } from "@/lib/admin/context";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import type { CoverageProgramRow } from "@/lib/admin/types";

const PATHNAME = "/admin/coverage";

// Coverage programs. A facility's accreditation under a program (including
// YAKAP and GAMOT status) is recorded on the facility's page.
export default async function CoveragePage({ searchParams }: PageProps<"/admin/coverage">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const { data, count } = await supabase
    .from("coverage_program")
    .select("id, program_type, code, name, rules_version, source_url, last_reviewed_on", {
      count: "exact",
    })
    .order("name")
    .order("id")
    .range(from, to);
  const rows = (data ?? []) as CoverageProgramRow[];

  return (
    <>
      <PageHeader title={t("coverage.title")} />
      <p className="text-sm text-zinc-600">{t("coverage.accreditationHint")}</p>

      {rows.length === 0 ? (
        <Empty>{t("coverage.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((program) => (
            <li key={program.id}>
              <Link href={`${PATHNAME}/${program.id}`} className={ROW_LINK}>
                <span className="font-medium">{program.name}</span>
                <span className="text-sm text-zinc-600">
                  {t(`programTypes.${program.program_type}`)}
                  {` · ${t("coverage.version", { version: program.rules_version })}`}
                </span>
                <span className="text-sm text-zinc-600">
                  {program.last_reviewed_on
                    ? t("coverage.reviewedOn", {
                        date: format.dateTime(new Date(program.last_reviewed_on), { dateStyle: "medium" }),
                      })
                    : t("coverage.neverReviewed")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />

      <Section title={t("coverage.add")}>
        <ActionForm action={createCoverageProgram} submitLabel={t("coverage.add")} resetOnSave>
          <CoverageProgramFields />
        </ActionForm>
      </Section>
    </>
  );
}
