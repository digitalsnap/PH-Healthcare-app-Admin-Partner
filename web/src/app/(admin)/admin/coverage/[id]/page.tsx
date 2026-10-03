import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { CoverageProgramFields } from "@/components/admin/coverage-program-fields";
import { PageHeader } from "@/components/admin/fields";
import { updateCoverageProgram } from "@/lib/admin/actions/catalogue";
import { adminContext } from "@/lib/admin/context";
import { idSchema } from "@/lib/admin/schemas";
import type { CoverageProgramRow } from "@/lib/admin/types";

export default async function CoverageProgramPage({ params }: PageProps<"/admin/coverage/[id]">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data } = await supabase
    .from("coverage_program")
    .select("id, program_type, code, name, rules_version, source_url, last_reviewed_on")
    .eq("id", id.data)
    .maybeSingle();
  if (!data) notFound();
  const program = data as CoverageProgramRow;

  return (
    <>
      <PageHeader title={program.name} />
      <a href={program.source_url} target="_blank" rel="noreferrer noopener" className="text-sm underline">
        {t("common.sourceLink")}
      </a>
      <ActionForm action={updateCoverageProgram} submitLabel={t("common.save")}>
        <input type="hidden" name="id" value={program.id} />
        <CoverageProgramFields program={program} />
      </ActionForm>
    </>
  );
}
