// Reads every row of a PostgREST query, page by page.
//
// The Supabase API caps each response at its "max rows" setting (1000 by
// default) whatever .limit() asks for, and says nothing when it does — a
// report over a large range would quietly lose its last rows. This pages with
// .range() until a page comes back empty, so it works with any cap. The query
// must have a deterministic order (end it on a unique column) or pages can
// overlap or skip rows.
//
// Stops at `maxRows` and reports `truncated` rather than reading without end.

type PageResult<T> = { data: T[] | null; error: unknown };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = 1000, maxRows = 50_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<{ data: T[]; error: unknown; truncated: boolean }> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const want = Math.min(pageSize, maxRows - rows.length);
    const { data, error } = await page(rows.length, rows.length + want - 1);
    if (error) return { data: rows, error, truncated: false };
    if (!data || data.length === 0) return { data: rows, error: null, truncated: false };
    rows.push(...data);
  }
  // Exactly maxRows read: one more row means there were more than allowed.
  const { data: extra, error } = await page(maxRows, maxRows);
  if (error) return { data: rows, error, truncated: false };
  return { data: rows, error: null, truncated: !!extra && extra.length > 0 };
}
