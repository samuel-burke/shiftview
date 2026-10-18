import { vi } from "vitest";

// A small in-memory stand-in for the Supabase client: each table is a list of
// rows that eq / in / gte / lte / is filters, order sorts and range pages, so
// routes that page with fetchAllRows and resolve the caller with
// getOrgContext (managers / employees rows) work against it unchanged.
// Inserts and upserts are recorded in `writes`; rpc calls go to `rpc`.

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export type FakeOptions = {
  userId?: string | null;
  tables?: Record<string, Row[]>;
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  // A table whose reads fail.
  failing?: string[];
  // Result of insert(...).select().single() per table.
  insertResult?: Record<string, { data: unknown; error: unknown }>;
  pageCap?: number;
};

export function fakeSupabase(opts: FakeOptions = {}) {
  const tables = opts.tables ?? {};
  const writes: { table: string; op: "insert" | "upsert" | "update"; rows: unknown }[] = [];

  const builder = (table: string) => {
    const filters: Filter[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let write: { op: "insert" | "upsert" | "update"; rows: unknown } | null = null;
    let limitN: number | null = null;
    const fail = (opts.failing ?? []).includes(table);

    const rows = (): Row[] => {
      let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (orders.length) {
        out = [...out].sort((a, b) => {
          for (const { col, asc } of orders) {
            if (a[col] < b[col]) return asc ? -1 : 1;
            if (a[col] > b[col]) return asc ? 1 : -1;
          }
          return 0;
        });
      }
      return limitN === null ? out : out.slice(0, limitN);
    };
    const result = () => {
      if (write) {
        if (opts.insertResult?.[table]) return opts.insertResult[table];
        return { data: Array.isArray(write.rows) ? write.rows : [write.rows], error: null };
      }
      return fail ? { data: null, error: { message: "boom" } } : { data: rows(), error: null };
    };
    const single = () => {
      const r = result();
      if (write) return Promise.resolve(opts.insertResult?.[table] ?? { data: Array.isArray(write.rows) ? write.rows[0] : write.rows, error: null });
      return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
    };

    const b: any = {
      select: vi.fn(() => b),
      eq: vi.fn((c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; }),
      neq: vi.fn((c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; }),
      in: vi.fn((c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; }),
      gte: vi.fn((c: string, v: any) => { filters.push((r) => r[c] >= v); return b; }),
      lte: vi.fn((c: string, v: any) => { filters.push((r) => r[c] <= v); return b; }),
      is: vi.fn((c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; }),
      like: vi.fn(() => b),
      order: vi.fn((col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return b; }),
      limit: vi.fn((n: number) => { limitN = n; return b; }),
      range: vi.fn((from: number, to: number) => {
        const r = result();
        if (r.error) return Promise.resolve(r);
        const cap = opts.pageCap ?? 1000;
        return Promise.resolve({ data: (r.data as Row[]).slice(from, Math.min(to + 1, from + cap)), error: null });
      }),
      maybeSingle: vi.fn(single),
      single: vi.fn(single),
      insert: vi.fn((rows: unknown) => { write = { op: "insert", rows }; writes.push({ table, ...write }); return b; }),
      upsert: vi.fn((rows: unknown) => { write = { op: "upsert", rows }; writes.push({ table, ...write }); return b; }),
      update: vi.fn((rows: unknown) => { write = { op: "update", rows }; writes.push({ table, ...write }); return b; }),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return b;
  };

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) =>
    opts.rpc ? opts.rpc(fn, args) : { data: null, error: null });

  return {
    writes,
    rpc,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.userId ? { id: opts.userId, email: "x@test" } : null },
        error: null,
      }),
    },
    from: vi.fn(builder),
  };
}
