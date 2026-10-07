import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLogs: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: any) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLogs } from "@/lib/audit";
import { GET } from "./route";

type Call = { method: string; args: any[] };

/**
 * Admin client whose reads return the given rows and whose UPDATEs report
 * every requested id as updated (or fail with `updateError`). Each query's
 * chained calls are recorded in `queries` so tests can check the filters.
 */
function makeAdminClient({
  timezones = [] as { org_id: string; value: string }[],
  timeOff = [] as any[],
  swaps = [] as any[],
  employees = [] as any[],
  fetchError = null as any,
  updateError = null as any,
} = {}) {
  const queries: { table: string; calls: Call[] }[] = [];
  const reads: Record<string, any[]> = {
    app_settings: timezones,
    time_off_requests: timeOff,
    shift_swaps: swaps,
    employees,
  };
  const client = {
    from: vi.fn((table: string) => {
      const calls: Call[] = [];
      queries.push({ table, calls });
      const b: any = {};
      for (const m of ["select", "eq", "lte", "in", "update"]) {
        b[m] = vi.fn((...args: any[]) => {
          calls.push({ method: m, args });
          return b;
        });
      }
      b.then = (resolve: any, reject: any) => {
        let result;
        if (calls.some((c) => c.method === "update")) {
          const ids = calls.find((c) => c.method === "in" && c.args[0] === "id")!.args[1] as number[];
          result = updateError ? { data: null, error: updateError } : { data: ids.map((id) => ({ id })), error: null };
        } else if (fetchError && table === "time_off_requests") {
          result = { data: null, error: fetchError };
        } else {
          result = { data: reads[table] ?? [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      };
      return b;
    }),
  };
  const updates = (table: string) =>
    queries
      .filter((q) => q.table === table && q.calls.some((c) => c.method === "update"))
      .map((q) => ({
        set: q.calls.find((c) => c.method === "update")!.args[0],
        ids: q.calls.find((c) => c.method === "in" && c.args[0] === "id")!.args[1],
        statuses: q.calls.find((c) => c.method === "in" && c.args[0] === "status")?.args[1],
      }));
  return { client, queries, updates };
}

function cronRequest(secret = "test-secret") {
  return new Request("http://localhost/api/cron/expire-requests", { headers: { "x-cron-secret": secret } });
}

const on = (dateA: string, dateB = dateA) => ({ schedule_a: { date: dateA }, schedule_b: { date: dateB } });

describe("GET /api/cron/expire-requests", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(createAdminClient).mockReset();
    vi.mocked(writeAuditLogs).mockClear();
    // 02:00 UTC on Oct 8: still Oct 7 in New York (the default timezone), but
    // already 11:00 on Oct 8 in Tokyo.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns 401 without the cron secret", async () => {
    const res = await GET(cronRequest("wrong-secret"));
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("denies pending time off for each store's today and earlier, in its own timezone", async () => {
    const admin = makeAdminClient({
      timezones: [{ org_id: "org-tokyo", value: "Asia/Tokyo" }],
      timeOff: [
        { id: 1, org_id: "org-ny", employee_id: 7, date: "2026-10-07" },    // New York's today
        { id: 2, org_id: "org-ny", employee_id: 7, date: "2026-10-08" },    // New York's tomorrow
        { id: 3, org_id: "org-tokyo", employee_id: 7, date: "2026-10-08" }, // Tokyo's today
        { id: 4, org_id: "org-ny", employee_id: 8, date: "2026-10-01" },    // a past day
      ],
      employees: [
        { id: 7, org_id: "org-ny", name: "Alice Smith" },
        { id: 7, org_id: "org-tokyo", name: "Kenji Sato" },
        { id: 8, org_id: "org-ny", name: "Bob Jones" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);

    const res = await GET(cronRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timeOff: 3, swaps: 0 });

    // Only still-pending requests up to the latest possible store "today" are read…
    const read = admin.queries.find((q) => q.table === "time_off_requests")!.calls;
    expect(read).toContainEqual({ method: "eq", args: ["status", "pending"] });
    expect(read).toContainEqual({ method: "lte", args: ["date", "2026-10-09"] });
    // …and the update re-checks that they're still pending. Nothing is deleted.
    expect(admin.updates("time_off_requests")).toEqual([{ set: { status: "denied" }, ids: [1, 3, 4], statuses: ["pending"] }]);

    const denied = { before: { status: "pending" }, after: { status: "denied" } };
    expect(writeAuditLogs).toHaveBeenCalledWith([
      expect.objectContaining({ action: "time_off.auto_deny", orgId: "org-ny", resourceId: "1", ...denied, metadata: { employeeId: 7, employeeName: "Alice Smith", date: "2026-10-07" } }),
      expect.objectContaining({ action: "time_off.auto_deny", orgId: "org-tokyo", resourceId: "3", ...denied, metadata: { employeeId: 7, employeeName: "Kenji Sato", date: "2026-10-08" } }),
      expect.objectContaining({ action: "time_off.auto_deny", orgId: "org-ny", resourceId: "4", ...denied, metadata: { employeeId: 8, employeeName: "Bob Jones", date: "2026-10-01" } }),
    ]);
  });

  it("denies swaps still awaiting the coworker or a manager once either shift's day arrives", async () => {
    const admin = makeAdminClient({
      timezones: [{ org_id: "org-tokyo", value: "Asia/Tokyo" }],
      swaps: [
        { id: 10, org_id: "org-ny", status: "accepted", requester_id: 1, target_id: 2, ...on("2026-10-07") },
        { id: 11, org_id: "org-ny", status: "pending", requester_id: 1, target_id: 2, ...on("2026-10-08") },
        { id: 12, org_id: "org-tokyo", status: "pending", requester_id: 3, target_id: 4, ...on("2026-10-09", "2026-10-08") },
        { id: 13, org_id: "org-ny", status: "pending", requester_id: 1, target_id: 2, schedule_a: null, schedule_b: null },
      ],
      employees: [
        { id: 1, org_id: "org-ny", name: "Alice Smith" },
        { id: 2, org_id: "org-ny", name: "Bob Jones" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);

    const res = await GET(cronRequest());
    expect(await res.json()).toEqual({ timeOff: 0, swaps: 2 });

    const read = admin.queries.find((q) => q.table === "shift_swaps")!.calls;
    expect(read).toContainEqual({ method: "in", args: ["status", ["pending", "accepted"]] });
    expect(admin.updates("shift_swaps")).toEqual([{ set: { status: "denied" }, ids: [10, 12], statuses: ["pending", "accepted"] }]);
    expect(admin.updates("time_off_requests")).toEqual([]);

    expect(writeAuditLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        action: "swap.auto_deny",
        orgId: "org-ny",
        resourceId: "10",
        before: { status: "accepted" },
        after: { status: "denied" },
        metadata: { requesterId: 1, requesterName: "Alice Smith", targetId: 2, targetName: "Bob Jones", date: "2026-10-07" },
      }),
      expect.objectContaining({
        action: "swap.auto_deny",
        orgId: "org-tokyo",
        resourceId: "12",
        before: { status: "pending" },
        after: { status: "denied" },
        metadata: { requesterId: 3, requesterName: null, targetId: 4, targetName: null, date: "2026-10-08" },
      }),
    ]);
  });

  it("does nothing when no request has expired", async () => {
    const admin = makeAdminClient({
      timeOff: [{ id: 2, org_id: "org-ny", employee_id: 7, date: "2026-10-08" }],
      swaps: [{ id: 11, org_id: "org-ny", status: "pending", requester_id: 1, target_id: 2, ...on("2026-10-08") }],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);

    const res = await GET(cronRequest());
    expect(await res.json()).toEqual({ timeOff: 0, swaps: 0 });
    expect(admin.queries.filter((q) => q.calls.some((c) => c.method === "update"))).toEqual([]);
    expect(admin.queries.some((q) => q.table === "employees")).toBe(false);
    expect(writeAuditLogs).toHaveBeenCalledWith([]);
  });

  it("updates in batches of 100 ids", async () => {
    const timeOff = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, org_id: "org-ny", employee_id: 7, date: "2026-10-01" }));
    const admin = makeAdminClient({ timeOff });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);

    const res = await GET(cronRequest());
    expect(await res.json()).toEqual({ timeOff: 150, swaps: 0 });
    expect(admin.updates("time_off_requests").map((u) => u.ids.length)).toEqual([100, 50]);
  });

  it("returns 500 when the requests can't be read", async () => {
    const admin = makeAdminClient({ fetchError: { message: "boom" } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);
    const res = await GET(cronRequest());
    expect(res.status).toBe(500);
    expect(admin.queries.filter((q) => q.calls.some((c) => c.method === "update"))).toEqual([]);
  });

  it("returns 500 when an update fails, without logging what wasn't denied", async () => {
    const admin = makeAdminClient({
      timeOff: [{ id: 1, org_id: "org-ny", employee_id: 7, date: "2026-10-07" }],
      updateError: { message: "boom" },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as any);
    const res = await GET(cronRequest());
    expect(res.status).toBe(500);
    expect(writeAuditLogs).toHaveBeenCalledWith([]);
  });
});
