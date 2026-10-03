export const PAGE_SIZE = 20;

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter, or undefined when absent or empty. */
export function param(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === "" ? undefined : first;
}

/** 1-based page number from the query string; anything invalid is page 1. */
export function pageOf(searchParams: SearchParams): number {
  const page = Number(param(searchParams, "page"));
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

/** Inclusive row range for a page, as PostgREST's range() expects. */
export function rangeOf(page: number, pageSize: number = PAGE_SIZE): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** A link to another page of the same list, keeping the active filters. */
export function pageHref(pathname: string, searchParams: SearchParams, page: number): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(searchParams)) {
    const value = param(searchParams, key);
    if (value !== undefined && key !== "page") query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}
