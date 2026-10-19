// /api/break-types and /api/break-types/[id] (migration 0065): who can read
// and change a store's break types, and how a request is checked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/require-manager", () => ({ requireManager: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const USER = { id: "user-1" };

type Row = { id: number; org_id: string; name: string; paid: boolean; min_minutes: number | null; sort_order: number; archived_at: string | null };
let table: Row[];
let calls: { op: string; filters: Record<string, unknown>; payload?: unknown }[];
let writeError: { code: string } | null;

function client() {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe("break_types");
      const filters: Record<string, unknown> = {};
      let op = "select";
      let payload: unknown;
      const b: any = {};
      b.select = vi.fn(() => b);
      b.order = vi.fn(() => b);
      b.eq = vi.fn((c: string, v: unknown) => { filters[c] = v; return b; });
      b.insert = vi.fn((rows: unknown) => { op = "insert"; payload = rows; return b; });
      b.update = vi.fn((patch: unknown) => { op = "update"; payload = patch; return b; });
      const matching = () => table.filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v));
      const run = () => {
        calls.push({ op, filters: { ...filters }, payload });
        if (op !== "select" && writeError) return { data: null, error: writeError };
        if (op === "insert") {
          const rows = (payload as Omit<Row, "id">[]).map((r, i) => ({ id: 100 + i, archived_at: null, ...r }) as Row);
          table.push(...rows);
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        if (op === "update") {
          const hit = matching();
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit[0] ? { id: hit[0].id } : null, error: null };
        }
        return { data: matching(), error: null };
      };
      b.maybeSingle = vi.fn(async () => run());
      b.then = (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
      return b;
    }),
  };
}

function as(role: "manager" | "employee" | "anon", orgId = ORG_A) {
  vi.mocked(createClient).mockResolvedValue(client() as any);
  vi.mocked(getOrgContext).mockResolvedValue(
    role === "anon"
      ? ({ ctx: null, user: null, error: "Not authenticated" } as any)
      : ({ ctx: { user: USER, orgId, isManager: role === "manager", isOwner: false, employeeId: 1, isDemo: false }, user: USER, error: null } as any),
  );
  vi.mocked(requireManager).mockResolvedValue(
    role === "manager"
      ? ({ user: USER, orgId, error: null } as any)
      : ({ user: role === "anon" ? null : USER, orgId: null, error: role === "anon" ? "Not authenticated" : "Manager access required" } as any),
  );
}

const req = (url: string, body?: unknown, method = "POST") =>
  new Request(`http://localhost${url}`, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  writeError = null;
  table = [
    { id: 1, org_id: ORG_A, name: "Rest", paid: true, min_minutes: 10, sort_order: 0, archived_at: null },
    { id: 2, org_id: ORG_A, name: "Old", paid: false, min_minutes: null, sort_order: 1, archived_at: "2026-01-01T00:00:00Z" },
    { id: 3, org_id: ORG_B, name: "Lunch", paid: false, min_minutes: 30, sort_order: 0, archived_at: null },
  ];
});

describe("GET /api/break-types", () => {
  it("401s when signed out", async () => {
    as("anon");
    expect((await GET(req("/api/break-types"))).status).toBe(401);
  });

  it("gives an employee their own store's active types only", async () => {
    as("employee");
    const body = await (await GET(req("/api/break-types"))).json();
    expect(body.breakTypes).toEqual([{ id: 1, name: "Rest", paid: true, minMinutes: 10, sortOrder: 0, archived: false }]);
    expect(calls[0].filters).toEqual({ org_id: ORG_A });
  });

  it("never lists another store's types", async () => {
    as("employee", ORG_B);
    const body = await (await GET(req("/api/break-types?all=1"))).json();
    expect(body.breakTypes.map((t: any) => t.name)).toEqual(["Lunch"]);
  });

  it("adds archived types for a manager who asks, but not for an employee", async () => {
    as("manager");
    expect((await (await GET(req("/api/break-types?all=1"))).json()).breakTypes.map((t: any) => t.id)).toEqual([1, 2]);
    as("employee");
    expect((await (await GET(req("/api/break-types?all=1"))).json()).breakTypes.map((t: any) => t.id)).toEqual([1]);
  });
});

describe("POST /api/break-types", () => {
  it("is manager-only", async () => {
    as("employee");
    expect((await POST(req("/api/break-types", { name: "Meal", paid: false }))).status).toBe(403);
    as("anon");
    expect((await POST(req("/api/break-types", { name: "Meal", paid: false }))).status).toBe(401);
    expect(calls.filter((c) => c.op === "insert")).toEqual([]);
  });

  it.each([
    [{ name: "", paid: false }, /name is required/],
    [{ name: "x".repeat(41), paid: false }, /40 characters/],
    [{ name: "Meal" }, /paid must be a boolean/],
    [{ name: "Meal", paid: false, minMinutes: 0 }, /minMinutes/],
    [{ name: "Meal", paid: false, minMinutes: 241 }, /minMinutes/],
    [{ name: "Meal", paid: false, minMinutes: 12.5 }, /minMinutes/],
  ])("400s on a bad body %j", async (body, msg) => {
    as("manager");
    const res = await POST(req("/api/break-types", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(msg);
  });

  it("adds a type to the manager's own store", async () => {
    as("manager");
    const res = await POST(req("/api/break-types", { name: "  Meal  ", paid: false, minMinutes: 30 }));
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.op === "insert")!;
    expect(insert.payload).toEqual([expect.objectContaining({ org_id: ORG_A, name: "Meal", paid: false, min_minutes: 30, sort_order: 2 })]);
  });

  it("saves the default unpaid Break first when a store adds its first type", async () => {
    as("manager", ORG_B);
    table = table.filter((r) => r.org_id !== ORG_B);
    await POST(req("/api/break-types", { name: "Rest", paid: true, minMinutes: 10 }));
    const insert = calls.find((c) => c.op === "insert")!;
    expect(insert.payload).toEqual([
      expect.objectContaining({ org_id: ORG_B, name: "Break", paid: false, min_minutes: null, sort_order: 0 }),
      expect.objectContaining({ org_id: ORG_B, name: "Rest", paid: true, min_minutes: 10, sort_order: 1 }),
    ]);
  });

  it("409s on a name already in use, in any case", async () => {
    as("manager");
    expect((await POST(req("/api/break-types", { name: "REST", paid: false }))).status).toBe(409);
    writeError = { code: "23505" };
    expect((await POST(req("/api/break-types", { name: "Meal", paid: false }))).status).toBe(409);
  });
});

describe("PATCH /api/break-types/[id]", () => {
  it("is manager-only", async () => {
    as("employee");
    expect((await PATCH(req("/api/break-types/1", { paid: false }, "PATCH"), params("1"))).status).toBe(403);
    expect(table[0].paid).toBe(true);
  });

  it("changes a type in the manager's store", async () => {
    as("manager");
    const res = await PATCH(req("/api/break-types/1", { name: "Coffee", paid: false, minMinutes: null }, "PATCH"), params("1"));
    expect(res.status).toBe(200);
    expect(table[0]).toMatchObject({ name: "Coffee", paid: false, min_minutes: null });
    expect(calls.at(-1)!.filters).toEqual({ org_id: ORG_A, id: 1 });
  });

  it("archives and restores", async () => {
    as("manager");
    await PATCH(req("/api/break-types/1", { archived: true }, "PATCH"), params("1"));
    expect(table[0].archived_at).not.toBeNull();
    await PATCH(req("/api/break-types/1", { archived: false }, "PATCH"), params("1"));
    expect(table[0].archived_at).toBeNull();
  });

  it("404s on another store's type and leaves it alone", async () => {
    as("manager");
    const res = await PATCH(req("/api/break-types/3", { paid: true }, "PATCH"), params("3"));
    expect(res.status).toBe(404);
    expect(table[2].paid).toBe(false);
  });

  it.each([
    ["abc", { paid: true }],
    ["1", {}],
    ["1", { paid: "yes" }],
    ["1", { archived: 1 }],
    ["1", { name: "   " }],
  ])("400s on id %s with %j", async (id, body) => {
    as("manager");
    expect((await PATCH(req(`/api/break-types/${id}`, body, "PATCH"), params(id))).status).toBe(400);
  });
});
