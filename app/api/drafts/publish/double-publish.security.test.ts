import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

// Regression: publishing read the week's drafts, inserted them as live shifts,
// then deleted the drafts. Two publishes at once (a double click on Publish,
// or two managers) both read the same drafts and every shift went live twice.
// Now each publish first deletes the drafts it will publish and only publishes
// the rows it actually removed.

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

type Draft = { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number; generation_run_id: number | null };

// Shared tables; every round trip yields so two requests interleave.
function fakeDb({ failInsert = false } = {}) {
  let drafts: Draft[] = [
    { id: 1, employee_id: 10, date: "2026-06-01", start_minutes: 480, end_minutes: 960, generation_run_id: 4 },
    { id: 2, employee_id: 11, date: "2026-06-02", start_minutes: 540, end_minutes: 1020, generation_run_id: 4 },
  ];
  const schedules: { employee_id: number; date: string }[] = [];
  let nextDraftId = 100;

  const from = (table: string) => {
    let op: "select" | "delete" | "insert" | "update" = "select";
    let ids: number[] | null = null;
    let rows: Record<string, unknown>[] = [];
    const b: any = {};
    for (const m of ["eq", "gte", "lte", "is", "order", "limit"]) b[m] = vi.fn(() => b);
    b.select = vi.fn(() => b);
    b.in = vi.fn((_c: string, v: number[]) => { ids = v; return b; });
    b.delete = vi.fn(() => { op = "delete"; return b; });
    b.update = vi.fn(() => { op = "update"; return b; });
    b.insert = vi.fn((r: Record<string, unknown>[]) => { op = "insert"; rows = r; return b; });
    const run = async () => {
      await new Promise((r) => setTimeout(r, 0));
      if (table === "managers") return { data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false }, error: null };
      if (table === "draft_schedules") {
        if (op === "select") return { data: drafts.map((d) => ({ ...d })), error: null };
        if (op === "delete") {
          const removed = drafts.filter((d) => ids!.includes(d.id));
          drafts = drafts.filter((d) => !ids!.includes(d.id));
          return { data: removed, error: null };
        }
        if (op === "insert") {
          drafts.push(...rows.map((r) => ({ ...(r as Draft), id: nextDraftId++ })));
          return { data: null, error: null };
        }
      }
      if (table === "schedules") {
        if (op === "select") return { data: schedules.map((s) => ({ ...s })), error: null };
        if (op === "insert") {
          if (failInsert) return { data: null, error: { message: "insert failed" } };
          schedules.push(...rows.map((r) => ({ employee_id: r.employee_id as number, date: r.date as string })));
          return { data: null, error: null };
        }
      }
      return { data: [], error: null };
    };
    b.maybeSingle = vi.fn(run);
    b.then = (resolve: any, reject: any) => run().then(resolve, reject);
    return b;
  };

  return {
    get drafts() { return drafts; },
    schedules,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
      from: vi.fn(from),
    },
  };
}

function publish() {
  return POST(new Request("http://localhost/api/drafts/publish", {
    method: "POST",
    body: JSON.stringify({ weekStart: "2026-06-01" }),
  }));
}

describe("POST /api/drafts/publish twice at once", () => {
  it("puts each shift live exactly once", async () => {
    const db = fakeDb();
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const results = await Promise.all([publish(), publish()]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(db.schedules).toHaveLength(2);
    expect(bodies.map((b) => b.published).sort()).toEqual([0, 2]);
    expect(db.drafts).toHaveLength(0);
  });

  it("puts the drafts back when the shifts can't be created", async () => {
    const db = fakeDb({ failInsert: true });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await publish();
    expect(res.status).toBe(500);
    expect(db.schedules).toHaveLength(0);
    expect(db.drafts.map((d) => [d.employee_id, d.date, d.generation_run_id])).toEqual([
      [10, "2026-06-01", 4],
      [11, "2026-06-02", 4],
    ]);
  });
});
