import { describe, it, expect, vi } from "vitest";
import { fetchAllRows } from "./fetch-all-rows";

// A table of `total` rows behind an API that returns at most `cap` per request,
// whatever range is asked for — as Supabase's "max rows" setting does.
function table(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + cap)),
    error: null,
  }));
}

describe("fetchAllRows", () => {
  it("reads past the API's per-request row cap", async () => {
    const page = table(2_345, 1_000);
    const { data, error, truncated } = await fetchAllRows(page);
    expect(error).toBeNull();
    expect(truncated).toBe(false);
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 2_345 }, (_, i) => i + 1));
  });

  it("works when the cap is smaller than the page size", async () => {
    const { data } = await fetchAllRows(table(1_234, 250));
    expect(data).toHaveLength(1_234);
    expect(new Set(data.map((r) => r.id)).size).toBe(1_234);
  });

  it("returns an empty list for an empty table", async () => {
    expect(await fetchAllRows(table(0, 1_000))).toEqual({ data: [], error: null, truncated: false });
  });

  it("reports truncation instead of silently stopping at maxRows", async () => {
    const { data, truncated } = await fetchAllRows(table(120, 1_000), { pageSize: 50, maxRows: 100 });
    expect(data).toHaveLength(100);
    expect(truncated).toBe(true);
  });

  it("is not truncated when the table holds exactly maxRows", async () => {
    const { data, truncated } = await fetchAllRows(table(100, 1_000), { pageSize: 50, maxRows: 100 });
    expect(data).toHaveLength(100);
    expect(truncated).toBe(false);
  });

  it("stops and returns the error from a failed page", async () => {
    const page = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { error } = await fetchAllRows(page, { pageSize: 1 });
    expect(error).toEqual({ message: "boom" });
    expect(page).toHaveBeenCalledTimes(2);
  });
});
