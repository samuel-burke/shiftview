// An in-memory stand-in for the Supabase client, for route tests that need
// real reads and writes rather than canned responses: inserts get ids, filters
// filter, updates and deletes change what later queries see. It covers the
// query-builder calls the API routes use; anything else throws, so a test
// can't pass by accident on an unsupported call.

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export type FakeDbOptions = {
  // Column sets that must be unique per table, e.g. { schedules: [["org_id", "employee_id", "date"]] }.
  unique?: Record<string, string[][]>;
  // The signed-in user supabase.auth.getUser() returns (default: nobody).
  user?: { id: string; email?: string } | null;
  // Handlers for supabase.rpc(name, args).
  rpc?: Record<string, (args: Row, db: FakeDb) => { data: unknown; error: unknown } | unknown>;
};

export type FakeDb = ReturnType<typeof createFakeDb>;

function project(row: Row, columns: string | undefined): Row {
  if (!columns || columns.includes("*") || columns.includes("(")) return { ...row };
  const out: Row = {};
  for (const raw of columns.split(",")) {
    const col = raw.trim();
    if (col) out[col] = row[col] ?? null;
  }
  return out;
}

const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

export function createFakeDb(seed: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {};
  const nextId: Record<string, number> = {};
  const calls: { table: string; op: string; payload?: unknown }[] = [];

  const table = (name: string) => (tables[name] ??= []);
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
    nextId[name] = Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
  }

  function violatesUnique(name: string, candidate: Row, ignore?: Row): boolean {
    for (const cols of options.unique?.[name] ?? []) {
      const clash = table(name).some(
        (r) => r !== ignore && r !== candidate && cols.every((c) => String(norm(r[c])) === String(norm(candidate[c])))
      );
      if (clash) return true;
    }
    return false;
  }

  function from(name: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row[] | Row | null = null;
    let returning: string | undefined;
    let wantsReturn = false;
    let selectCols: string | undefined;
    let countOpt: string | undefined;
    const orderBy: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let rangeArgs: [number, number] | null = null;

    const b: Row = {};
    b.select = (cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (op === "select") selectCols = cols;
      else { wantsReturn = true; returning = cols; }
      countOpt = opts?.count;
      return b;
    };
    b.insert = (rows: Row | Row[]) => { op = "insert"; payload = rows; return b; };
    let onConflict: string[] | null = null;
    b.upsert = (rows: Row | Row[], opts?: { onConflict?: string }) => {
      op = "upsert";
      payload = rows;
      onConflict = opts?.onConflict ? opts.onConflict.split(",").map((c) => c.trim()) : null;
      return b;
    };
    b.update = (patch: Row) => { op = "update"; payload = patch; return b; };
    b.delete = () => { op = "delete"; return b; };
    b.eq = (c: string, v: unknown) => { filters.push((r) => String(norm(r[c])) === String(norm(v)) && r[c] != null); return b; };
    b.neq = (c: string, v: unknown) => { filters.push((r) => String(norm(r[c])) !== String(norm(v))); return b; };
    b.in = (c: string, vs: unknown[]) => { const set = new Set(vs.map((v) => String(v))); filters.push((r) => set.has(String(r[c]))); return b; };
    b.gte = (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] >= v); return b; };
    b.lte = (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] <= v); return b; };
    b.gt = (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] > v); return b; };
    b.lt = (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] < v); return b; };
    b.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; };
    b.not = (c: string, operator: string, v: unknown) => {
      if (operator !== "is") throw new Error(`fake-db: not(${operator}) unsupported`);
      filters.push((r) => (v === null ? r[c] != null : r[c] !== v));
      return b;
    };
    b.order = (col: string, o?: { ascending?: boolean }) => { orderBy.push({ col, asc: o?.ascending !== false }); return b; };
    b.limit = (n: number) => { limitN = n; return b; };
    b.range = (lo: number, hi: number) => { rangeArgs = [lo, hi]; return b; };

    function matches(): Row[] {
      return table(name).filter((r) => filters.every((f) => f(r)));
    }

    function run(): { data: any; error: any; count?: number } {
      calls.push({ table: name, op, payload });
      if (op === "select") {
        let rows = matches();
        for (const { col, asc } of [...orderBy].reverse()) {
          rows = [...rows].sort((a, z) => (a[col] === z[col] ? 0 : (a[col] > z[col] ? 1 : -1) * (asc ? 1 : -1)));
        }
        const count = rows.length;
        if (rangeArgs) rows = rows.slice(rangeArgs[0], rangeArgs[1] + 1);
        if (limitN != null) rows = rows.slice(0, limitN);
        return { data: rows.map((r) => project(r, selectCols)), error: null, count: countOpt ? count : undefined };
      }
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        const added: Row[] = [];
        const inserted: Row[] = [];
        for (const raw of list) {
          // An upsert updates the row it conflicts with instead of inserting.
          if (op === "upsert" && onConflict) {
            const cols = onConflict;
            const hit = table(name).find((r) => cols.every((c) => String(norm(r[c])) === String(norm(raw[c]))));
            if (hit) {
              const before = { ...hit };
              Object.assign(hit, raw);
              if (violatesUnique(name, hit, hit)) {
                Object.assign(hit, before);
                return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${name}` } };
              }
              added.push(hit);
              continue;
            }
          }
          const row: Row = { ...raw };
          if (row.id == null) {
            row.id = nextId[name] ?? 1;
            nextId[name] = row.id + 1;
          }
          if (violatesUnique(name, row)) {
            // Roll back this statement's rows: Postgres inserts all or none.
            for (const a of inserted) table(name).splice(table(name).indexOf(a), 1);
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${name}` } };
          }
          table(name).push(row);
          added.push(row);
          inserted.push(row);
        }
        return { data: wantsReturn ? added.map((r) => project(r, returning)) : null, error: null };
      }
      if (op === "update") {
        const hit = matches();
        for (const r of hit) {
          const before = { ...r };
          Object.assign(r, payload);
          if (violatesUnique(name, r, r)) {
            Object.assign(r, before);
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${name}` } };
          }
        }
        return { data: wantsReturn ? hit.map((r) => project(r, returning)) : null, error: null };
      }
      // delete
      const hit = matches();
      tables[name] = table(name).filter((r) => !hit.includes(r));
      return { data: wantsReturn ? hit.map((r) => project(r, returning)) : null, error: null };
    }

    b.maybeSingle = async () => {
      const res = run();
      if (res.error) return res;
      const rows = Array.isArray(res.data) ? res.data : [];
      if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      return { data: rows[0] ?? null, error: null };
    };
    b.single = async () => {
      const res = run();
      if (res.error) return res;
      const rows = Array.isArray(res.data) ? res.data : [];
      if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
      return { data: rows[0], error: null };
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject);
    return b;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: options.user ?? null }, error: null }) },
    from,
    rpc: async (fn: string, args: Row = {}) => {
      const handler = options.rpc?.[fn];
      if (!handler) throw new Error(`fake-db: no rpc handler for ${fn}`);
      const out = handler(args, api) as { data?: unknown; error?: unknown } | undefined;
      return out && typeof out === "object" && ("data" in out || "error" in out) ? out : { data: out ?? null, error: null };
    },
  };

  const api = {
    client,
    tables,
    calls,
    rows: (name: string) => table(name),
  };
  return api;
}
