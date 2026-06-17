import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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

function builder({ thenData = null as any, single = null as any } = {}) {
  const b: any = {};
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  employeeId = 5 as number | null,
  employeeName = "Alex P",
  scheduleRows = [] as any[],
} = {}) {
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: employeeName } : null;
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: employeeRow });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const req = () => new Request("http://localhost/api/my-schedule/calendar");

describe("GET /api/my-schedule/calendar", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req())).status).toBe(401);
  });

  it("serves a text/calendar response with the right content-disposition", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [{ id: 1, employee_id: 5, date: "2026-07-06", start_minutes: 480, end_minutes: 1020 }],
      }) as any
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/calendar/);
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    expect(res.headers.get("Content-Disposition")).toMatch(/\.ics/);
  });

  it("includes a VEVENT for each scheduled shift", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [
          { id: 1, employee_id: 5, date: "2026-07-06", start_minutes: 480, end_minutes: 1020 },
          { id: 2, employee_id: 5, date: "2026-07-08", start_minutes: 540, end_minutes: 960 },
        ],
      }) as any
    );
    const res = await GET(req());
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain("DTSTART:20260706T080000");
    // Stable per-shift UID so re-importing updates rather than duplicates.
    expect(body).toContain("UID:shiftview-1-");
  });

  it("returns an empty but valid calendar when there are no shifts", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const res = await GET(req());
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("returns an empty calendar for a manager-only account with no employee record", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, employeeId: null }) as any);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
  });
});
