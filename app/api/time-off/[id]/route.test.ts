import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("PUT /api/time-off/[id]", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
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
});

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — time-off/[id] route", () => {
  it("scopes time_off_requests update to org_id", async () => {
    const timeOffEqArgs: [string, unknown][] = [];

    // Build a client where time_off_requests tracks eq calls on update
    const supabase = makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any;
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
