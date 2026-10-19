import { describe, it, expect, vi } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

// Regression: approving an open shift checked "still open", then inserted the
// schedule, then marked the shift filled. Two approvals at once (two managers
// picking different claimants, or a double tap) both passed the check, so the
// shift was booked twice. Now the shift is taken with a conditional
// open → filled update first, and only the request that wins it schedules.

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

// One shared in-memory open shift, two claims, and the schedules table; reads
// and writes interleave like concurrent requests against one database.
function fakeDb({ failScheduleInsert = false } = {}) {
  const shift = { id: 3, date: "2026-07-05", start_minutes: 480, end_minutes: 960, status: "open", filled_by: null as number | null };
  const claims = [
    { id: 9, open_shift_id: 3, employee_id: 5, status: "pending" },
    { id: 10, open_shift_id: 3, employee_id: 6, status: "pending" },
  ];
  const schedules: { employee_id: number }[] = [];

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "insert" = "select";
    let values: Record<string, unknown> = {};
    const b: any = {};
    b.select = vi.fn(() => b);
    for (const m of ["order", "limit", "gte", "lte", "in", "or", "neq"]) b[m] = vi.fn(() => b);
    b.eq = vi.fn((col: string, val: unknown) => { filters[col] = val; return b; });
    b.update = vi.fn((v: Record<string, unknown>) => { op = "update"; values = v; return b; });
    b.insert = vi.fn((v: Record<string, unknown>) => { op = "insert"; values = v; return b; });
    const run = async () => {
      // Let the other request run between every database round trip.
      await new Promise((r) => setTimeout(r, 0));
      if (table === "managers") return { data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false }, error: null };
      if (table === "open_shifts") {
        if (op === "select") return { data: { ...shift }, error: null };
        if (op === "update") {
          if (filters.status !== undefined && shift.status !== filters.status) return { data: [], error: null };
          Object.assign(shift, values);
          return { data: [{ id: shift.id }], error: null };
        }
      }
      if (table === "open_shift_claims") {
        if (op === "select") return { data: claims.find((c) => c.id === filters.id) ?? null, error: null };
        return { data: null, error: null };
      }
      if (table === "schedules") {
        if (op === "insert") {
          if (failScheduleInsert) return { data: null, error: { message: "insert failed" } };
          schedules.push({ employee_id: values.employee_id as number });
          return { data: null, error: null };
        }
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = vi.fn(run);
    b.single = vi.fn(run);
    b.then = (resolve: any, reject: any) => run().then(resolve, reject);
    return b;
  };

  return {
    shift,
    schedules,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
      from: vi.fn(from),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  };
}

function approve(claimId: number) {
  return PUT(
    new Request("http://localhost/api/open-shifts/3", {
      method: "PUT",
      body: JSON.stringify({ action: "approve", claimId }),
    }),
    { params: Promise.resolve({ id: "3" }) }
  );
}

describe("PUT /api/open-shifts/[id] approve", () => {
  it("two approvals at once book the shift exactly once", async () => {
    const db = fakeDb();
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const [a, b] = await Promise.all([approve(9), approve(10)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.schedules).toHaveLength(1);
    expect(db.shift.status).toBe("filled");
    expect(db.shift.filled_by).toBe(db.schedules[0].employee_id);
  });

  it("a double tap on the same claim books it once", async () => {
    const db = fakeDb();
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const [a, b] = await Promise.all([approve(9), approve(9)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.schedules).toEqual([{ employee_id: 5 }]);
  });

  it("puts the shift back up when the schedule can't be created", async () => {
    const db = fakeDb({ failScheduleInsert: true });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await approve(9);
    expect(res.status).toBe(500);
    expect(db.shift.status).toBe("open");
    expect(db.shift.filled_by).toBeNull();
  });
});
