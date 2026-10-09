import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { PUT } from "./[id]/route";
import { createClient } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);
const mockNotify = vi.mocked(notify);

type Correction = {
  id: number; employee_id: number; punch_type: string; punched_at: string; note: string; status: string;
};
type Punch = { punch_type: string; punched_at: string };

// Mock Supabase for the punch-corrections routes. Records filters, updates and
// inserts; prev/next punch lookups are answered from `history`.
function makeClient({
  isManager = true,
  correction = null as Correction | null,
  history = [] as Punch[],
  claimSucceeds = true,
  listRows = [] as Record<string, unknown>[],
} = {}) {
  const calls = {
    correctionFilters: [] as [string, unknown][],
    correctionUpdates: [] as Record<string, unknown>[],
    punchInserts: [] as Record<string, unknown>[],
  };

  // `single` answers .maybeSingle()/.single(); `list` answers an awaited query.
  const chain = (
    single: () => Promise<{ data: unknown; error: null }>,
    onEq?: (c: string, v: unknown) => void,
    list: () => Promise<{ data: unknown; error: null }> = single,
  ) => {
    const b: any = {};
    for (const m of ["select", "order", "limit", "in", "gte", "lt"]) b[m] = vi.fn().mockReturnValue(b);
    b.eq = vi.fn().mockImplementation((c: string, v: unknown) => { onEq?.(c, v); return b; });
    b.maybeSingle = vi.fn().mockImplementation(single);
    b.single = vi.fn().mockImplementation(single);
    b.then = (res: any, rej: any) => list().then(res, rej);
    return b;
  };

  const client = {
    calls,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        return chain(async () => ({ data: isManager ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false } : null, error: null }));
      }
      if (table === "employees") {
        return chain(
          async () => ({ data: { id: 5, org_id: MOCK_ORG_ID, user_id: "emp-user", name: "Alex Kim" }, error: null }),
          undefined,
          async () => ({ data: [{ id: 5, name: "Alex Kim" }], error: null }),
        );
      }
      if (table === "app_settings") {
        return chain(async () => ({ data: [{ key: "timezone", value: "America/New_York" }], error: null }));
      }
      if (table === "punch_corrections") {
        let pendingUpdate: Record<string, unknown> | null = null;
        const b = chain(
          async () => {
            if (pendingUpdate) {
              const claim = pendingUpdate.status !== "pending" && pendingUpdate.punch_id === undefined;
              return { data: claim ? (claimSucceeds ? { id: correction?.id } : null) : null, error: null };
            }
            return { data: correction, error: null };
          },
          (c, v) => calls.correctionFilters.push([c, v]),
          async () => ({ data: pendingUpdate ? null : listRows, error: null }),
        );
        b.update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
          pendingUpdate = row;
          calls.correctionUpdates.push(row);
          return b;
        });
        return b;
      }
      if (table === "punch_records") {
        const filters: { lt?: string; gte?: string } = {};
        const b: any = {};
        for (const m of ["select", "eq", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.lt = vi.fn().mockImplementation((_c: string, v: string) => { filters.lt = v; return b; });
        b.gte = vi.fn().mockImplementation((_c: string, v: string) => { filters.gte = v; return b; });
        b.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => { calls.punchInserts.push(row); return b; });
        b.single = vi.fn().mockResolvedValue({ data: { id: 501 }, error: null });
        b.maybeSingle = vi.fn().mockImplementation(async () => {
          const sorted = [...history].sort((a, c) => Date.parse(a.punched_at) - Date.parse(c.punched_at));
          if (filters.lt) return { data: [...sorted].reverse().find((p) => Date.parse(p.punched_at) < Date.parse(filters.lt!)) ?? null, error: null };
          if (filters.gte) return { data: sorted.find((p) => Date.parse(p.punched_at) >= Date.parse(filters.gte!)) ?? null, error: null };
          return { data: null, error: null };
        });
        return b;
      }
      return chain(async () => ({ data: null, error: null }));
    }),
  };
  return client;
}

const pending: Correction = {
  id: 7, employee_id: 5, punch_type: "clock_out", punched_at: "2026-10-31T21:00:00.000Z", note: "Forgot", status: "pending",
};

function review(id: number | string, body: Record<string, unknown>) {
  return PUT(
    new Request(`http://localhost/api/punch-corrections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
}

beforeEach(() => {
  mockNotify.mockClear();
  vi.mocked(writeAuditLog).mockClear();
});

describe("GET /api/punch-corrections", () => {
  it("gives managers the org's pending requests with employee names", async () => {
    const client = makeClient({
      listRows: [{ id: 7, employee_id: 5, punch_type: "clock_out", punched_at: pending.punched_at, note: "Forgot", status: "pending", created_at: "2026-11-01T12:00:00Z", reviewed_at: null, review_note: null }],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/punch-corrections"));
    const { corrections } = await res.json();
    expect(corrections).toEqual([expect.objectContaining({ id: 7, employeeName: "Alex Kim", punchType: "clock_out", status: "pending" })]);
    expect(client.calls.correctionFilters).toContainEqual(["status", "pending"]);
  });

  it("limits employees to their own requests", async () => {
    const client = makeClient({ isManager: false });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/punch-corrections?mine=true"));
    expect(client.calls.correctionFilters).toContainEqual(["employee_id", 5]);
    expect(client.calls.correctionFilters).not.toContainEqual(["status", "pending"]);
  });
});

describe("PUT /api/punch-corrections/[id]", () => {
  it("is manager-only", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, correction: pending }) as any);
    expect((await review(7, { status: "approved" })).status).toBe(403);
  });

  it("validates input", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ correction: pending }) as any);
    expect((await review("abc", { status: "approved" })).status).toBe(400);
    expect((await review(7, { status: "maybe" })).status).toBe(400);
  });

  it("approving creates the manual punch and notifies the employee", async () => {
    const client = makeClient({ correction: pending, history: [{ punch_type: "clock_in", punched_at: "2026-10-31T13:00:00Z" }] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await review(7, { status: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", punchId: 501 });
    expect(client.calls.punchInserts).toEqual([
      expect.objectContaining({ employee_id: 5, punch_type: "clock_out", punched_at: pending.punched_at, is_manual: true, note: "Forgot", org_id: MOCK_ORG_ID }),
    ]);
    // Claimed only while still pending, then linked to the new punch.
    expect(client.calls.correctionFilters).toContainEqual(["status", "pending"]);
    expect(client.calls.correctionUpdates).toContainEqual(expect.objectContaining({ status: "approved", reviewed_by: MOCK_USER.id }));
    expect(client.calls.correctionUpdates).toContainEqual({ punch_id: 501 });
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: "punch_correction_approved",
      body: "Your clock out at 5:00 PM on Sat, Oct 31 was approved.",
    }));
  });

  it("denying creates no punch and passes the manager's note on", async () => {
    const client = makeClient({ correction: pending });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await review(7, { status: "denied", reviewNote: "You left at 3" });
    expect(res.status).toBe(200);
    expect(client.calls.punchInserts).toHaveLength(0);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: "punch_correction_denied",
      body: expect.stringContaining("You left at 3"),
    }));
  });

  it("refuses to approve when the employee's punches no longer allow it", async () => {
    // Since filing, a later clock-in was recorded and there's no open shift to close.
    const client = makeClient({
      correction: { ...pending, punch_type: "clock_in" },
      history: [
        { punch_type: "clock_out", punched_at: "2026-10-30T21:00:00Z" },
        { punch_type: "clock_in", punched_at: "2026-11-01T13:00:00Z" },
      ],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await review(7, { status: "approved" });
    expect(res.status).toBe(409);
    expect(client.calls.punchInserts).toHaveLength(0);
    expect(client.calls.correctionUpdates).toHaveLength(0);
  });

  it("rejects a request that was already reviewed", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ correction: { ...pending, status: "approved" } }) as any);
    expect((await review(7, { status: "approved" })).status).toBe(409);
  });

  it("does not create a duplicate punch when another manager got there first", async () => {
    const client = makeClient({ correction: pending, claimSucceeds: false, history: [{ punch_type: "clock_in", punched_at: "2026-10-31T13:00:00Z" }] });
    mockCreateClient.mockResolvedValue(client as any);
    expect((await review(7, { status: "approved" })).status).toBe(409);
    expect(client.calls.punchInserts).toHaveLength(0);
  });

  it("returns 404 for an unknown request", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ correction: null }) as any);
    expect((await review(7, { status: "approved" })).status).toBe(404);
  });
});
