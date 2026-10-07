import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// A pending request for a day that hasn't arrived yet.
const UPCOMING_REQUEST = { employee_id: 5, date: "2099-12-31" };

function managerClient(request: Record<string, unknown> | null = UPCOMING_REQUEST) {
  return makeSupabaseClient({
    user: MOCK_USER,
    isManager: true,
    tableOverrides: { time_off_requests: { data: request, error: null } },
  });
}

describe("PUT /api/time-off/[id]", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(managerClient() as any);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "pending" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 and ok:true when manager approves a request", async () => {
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 and ok:true when manager denies a request", async () => {
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "denied" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 when the request doesn't exist", async () => {
    mockCreateClient.mockResolvedValue(managerClient(null) as any);
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/time-off/[id] — expired requests", () => {
  beforeEach(() => {
    // 02:00 UTC on Oct 8 is still Oct 7 in New York, the default store timezone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["2026-10-07", "2026-10-01"])("refuses to decide a request for %s once that day has arrived", async (date) => {
    const supabase = managerClient({ employee_id: 5, date }) as any;
    mockCreateClient.mockResolvedValue(supabase);
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This time-off request has expired" });
    // Only the lookup ran — nothing was updated.
    for (const { value: builder } of supabase.from.mock.results) expect(builder.update).not.toHaveBeenCalled();
  });

  it("still decides a request for the store's tomorrow", async () => {
    mockCreateClient.mockResolvedValue(managerClient({ employee_id: 5, date: "2026-10-08" }) as any);
    const res = await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "denied" }),
      }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
  });
});

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — time-off/[id] route", () => {
  it("scopes time_off_requests update to org_id", async () => {
    const timeOffEqArgs: [string, unknown][] = [];

    // Build a client where time_off_requests tracks eq calls on update
    const supabase = managerClient() as any;
    const origFrom = supabase.from.bind(supabase);
    supabase.from = vi.fn().mockImplementation((table: string) => {
      const b = origFrom(table);
      if (table === "time_off_requests") {
        const origEq = b.eq.bind(b);
        b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
          timeOffEqArgs.push([col, val]);
          return origEq(col, val);
        });
      }
      return b;
    });
    mockCreateClient.mockResolvedValue(supabase);
    await PUT(
      new Request("http://localhost/api/time-off/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      makeParams("1")
    );
    expect(timeOffEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
