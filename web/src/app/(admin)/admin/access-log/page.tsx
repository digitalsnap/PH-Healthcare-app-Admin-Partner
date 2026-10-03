import { getFormatter, getTranslations } from "next-intl/server";
import { Empty, LIST, PageHeader } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { adminContext } from "@/lib/admin/context";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import type { AccessLogRow } from "@/lib/admin/types";

const PATHNAME = "/admin/access-log";

// Who did what, and when. Shows ids and action codes only: the log never
// holds names or health details, and neither does this page.
export default async function AccessLogPage({ searchParams }: PageProps<"/admin/access-log">) {
  const { supabase } = await adminContext(["admin"]);
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const { data, count } = await supabase
    .from("access_log")
    .select("id, actor_id, subject_patient_id, action, resource_type, at", { count: "exact" })
    .order("at", { ascending: false })
    .order("id")
    .range(from, to);
  const rows = (data ?? []) as AccessLogRow[];

  // Display names of the staff accounts on this page only.
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id) => id !== null))];
  const { data: actors } =
    actorIds.length > 0
      ? await supabase.from("app_user").select("id, display_name").in("id", actorIds)
      : { data: [] };
  const names = new Map(
    ((actors ?? []) as { id: string; display_name: string | null }[]).map((actor) => [
      actor.id,
      actor.display_name,
    ]),
  );

  return (
    <>
      <PageHeader title={t("accessLog.title")} />
      {rows.length === 0 ? (
        <Empty>{t("accessLog.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-3 py-3 text-sm">
              <span className="font-mono">{row.action}</span>
              <span className="text-zinc-600">
                {row.actor_id
                  ? (names.get(row.actor_id) ?? t("accessLog.unknownActor"))
                  : t("accessLog.system")}
                {` · ${format.dateTime(new Date(row.at), { dateStyle: "medium", timeStyle: "short" })}`}
              </span>
              {row.subject_patient_id && (
                <span className="text-zinc-600">{t("accessLog.patientRecord")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />
    </>
  );
}
