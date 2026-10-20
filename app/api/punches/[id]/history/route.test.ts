import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-context", () => ({ getOrgContext: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const ROWS = [{
  id: 1, action: "update", changed_by: "mgr-user", changed_at: "2026-11-01T16:00:00Z", reason: "Badge reader down",
  old_row: { punch_type: "clock_in", punched_at: "2026-11-01T14:30:00Z", note: null, lat: 40.1, lng: -74.2 },
  new_row: { punch_type: "clock_in", punched_at: "2026-11-01T14:00:00Z", note: "Badge reader down", lat: 40.1, lng: -74.2 },
}, {
  id: 2, action: "update", changed_by: null, changed_at: "2026-11-01T17:00:00Z", reason: null,
  old_row: { punch_type: "clock_in", punched_at: "2026-11-01T14:00:00Z" },
  new_row: { punch_type: "clock_in", punched_at: "2026-11-01T13:59:00Z" },
}];

function makeClient() {
  const historyFilters: [string, unknown][] = [];
  const b: any = {};
  for (const m of ["select", "order", "in"]) b[m] = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockImplementation((c: string, v: unknown) => { historyFilters.push([c, v]); return b; });
  b.then = (res: any, rej: any) => Promise.resolve({ data: ROWS, error: null }).then(res, rej);
  const people: any = {};
  for (const m of ["select", "eq", "in"]) people[m] = vi.fn().mockReturnValue(people);
  people.then = (res: any, rej: any) => Promise.resolve({ data: [{ user_id: "mgr-user", name: "Ann" }], error: null }).then(res, rej);
  return {
    historyFilters,
    from: vi.fn().mockImplementation((table: string) => (table === "employees" ? people : b)),
  };
}

function asUser(isManager: boolean, employeeId: number | null) {
  vi.mocked(getOrgContext).mockResolvedValue({
    ctx: { orgId: MOCK_ORG_ID, user: MOCK_USER, isManager, isOwner: false, employeeId },
    error: null,
  } as any);
}

const get = (id: string) => GET(new Request(`http://localhost/api/punches/${id}/history`), { params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/punches/[id]/history", () => {
  it("returns who changed the punch, when, why, and the time it replaced", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client as any);
    asUser(true, null);
    const res = await get("7");
    expect(res.status).toBe(200);
    const { history } = await res.json();
    expect(history).toEqual([
      {
        id: 1, action: "update", changedAt: "2026-11-01T16:00:00Z", changedBy: "Ann", reason: "Badge reader down",
        before: { punchType: "clock_in", punchedAt: "2026-11-01T14:30:00Z", note: null },
        after:  { punchType: "clock_in", punchedAt: "2026-11-01T14:00:00Z", note: "Badge reader down" },
      },
      expect.objectContaining({ id: 2, changedBy: null }),
    ]);
    expect(client.historyFilters).toEqual([["org_id", MOCK_ORG_ID], ["punch_id", 7]]);
  });

  it("limits an employee to their own punches", async () => {
    const client = makeClient();
    vi.mocked(createClient).mockResolvedValue(client as any);
    asUser(false, 5);
    expect((await get("7")).status).toBe(200);
    expect(client.historyFilters).toContainEqual(["employee_id", 5]);
  });

  it("rejects a bad id and an unauthenticated caller", async () => {
    vi.mocked(createClient).mockResolvedValue(makeClient() as any);
    asUser(true, null);
    expect((await get("abc")).status).toBe(400);
    vi.mocked(getOrgContext).mockResolvedValue({ ctx: null, error: "Not authenticated" } as any);
    expect((await get("7")).status).toBe(401);
  });
});
