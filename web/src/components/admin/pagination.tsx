import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageCount, pageHref, type SearchParams } from "@/lib/admin/pagination";
import { LINK_BUTTON } from "./fields";

/** Previous / next links for a server-paginated list. */
export async function Pagination({
  pathname,
  searchParams,
  page,
  total,
}: {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  total: number;
}) {
  const t = await getTranslations("admin.common");
  const pages = pageCount(total);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-zinc-600">{t("pageOf", { page, pages, total })}</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={pageHref(pathname, searchParams, page - 1)} className={LINK_BUTTON}>
            {t("previous")}
          </Link>
        )}
        {page < pages && (
          <Link href={pageHref(pathname, searchParams, page + 1)} className={LINK_BUTTON}>
            {t("next")}
          </Link>
        )}
      </div>
    </nav>
  );
}
