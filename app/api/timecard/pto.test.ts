// The time card carries approved PTO and sick days as paid leave, apart from
// worked hours and overtime (migration 0064).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase-server";
import { fakeSupabase } from "../__tests__/fake-supabase";
import { MOCK_ORG_ID } from "../__tests__/helpers";
import { GET } from "./route";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const ORG = MOCK_ORG_ID;
// Mon–Fri Oct 12–16 2026, 9 AM – 6 PM EDT: 45 h worked, 5 h overtime.
const PUNCHES = ["12", "13", "14", "15", "16"].flatMap((d, i) => [
  { id: i * 2 + 1, org_id: ORG, employee_id: 1, punch_type: "clock_in", punched_at: `2026-10-${d}T13:00:00.000Z`, is_manual: false, note: null },
  { id: i * 2 + 2, org_id: ORG, employee_id: 1, punch_type: "clock_out", punched_at: `2026-10-${d}T22:00:00.000Z`, is_manual: false, note: null },
]);

function world(userId: string) {
  const c = fakeSupabase({
    userId,
    tables: {
      managers: [{ user_id: "mgr", org_id: ORG, is_owner: true }],
      employees: [{ id: 1, org_id: ORG, user_id: "emp1", name: "Ann" }, { id: 2, org_id: ORG, user_id: "emp2", name: "Bob" }],
      app_settings: [{ org_id: ORG, key: "timezone", value: "America/New_York" }],
      punch_records: PUNCHES,
      time_off_requests: [
        { id: 1, org_id: ORG, employee_id: 1, date: "2026-10-17", status: "approved", leave_type: "pto", paid_hours: "8.00" },
        { id: 2, org_id: ORG, employee_id: 1, date: "2026-10-18", status: "approved", leave_type: "sick", paid_hours: "4.50" },
        { id: 3, org_id: ORG, employee_id: 1, date: "2026-10-11", status: "approved", leave_type: "pto", paid_hours: "8.00" },
        { id: 4, org_id: ORG, employee_id: 1, date: "2026-10-13", status: "pending", leave_type: "pto", paid_hours: "8.00" },
        { id: 5, org_id: ORG, employee_id: 1, date: "2026-10-14", status: "cancelled", leave_type: "pto", paid_hours: "8.00" },
        { id: 6, org_id: ORG, employee_id: 1, date: "2026-10-15", status: "approved", leave_type: "unpaid", paid_hours: null },
        { id: 7, org_id: ORG, employee_id: 2, date: "2026-10-16", status: "approved", leave_type: "pto", paid_hours: "8.00" },
      ],
    },
  });
  vi.mocked(createClient).mockResolvedValue(c as any);
  return c;
}

const req = (qs: string) => new Request(`http://localhost/api/timecard?${qs}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/timecard — paid leave", () => {
  it("lists approved paid days in range, separate from worked hours and overtime", async () => {
    world("mgr");
    const res = await GET(req("employeeId=1&from=2026-10-12&to=2026-10-18"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paidLeave).toEqual([
      { date: "2026-10-17", leaveType: "pto", hours: 8 },
      { date: "2026-10-18", leaveType: "sick", hours: 4.5 },
    ]);
    expect(body.totalPtoHours).toBe(8);
    expect(body.totalSickHours).toBe(4.5);
    // PTO doesn't add to worked hours or overtime.
    expect(body.totalWorkedHours).toBe(45);
    expect(body.weeks[0]).toMatchObject({ totalWorkedHours: 45, overtimeHours: 5 });
  });

  it("an employee sees their own paid leave", async () => {
    world("emp1");
    const body = await (await GET(req("from=2026-10-12&to=2026-10-18"))).json();
    expect(body.totalPtoHours).toBe(8);
  });

  it("an employee cannot see another's", async () => {
    world("emp1");
    expect((await GET(req("employeeId=2&from=2026-10-12&to=2026-10-18"))).status).toBe(403);
  });

  it("the CSV export carries the leave rows", async () => {
    world("mgr");
    const res = await GET(req("employeeId=1&from=2026-10-12&to=2026-10-18&format=csv"));
    const lines = (await res.text()).split("\n");
    expect(lines[0].endsWith(",Paid Leave Hrs")).toBe(true);
    expect(lines).toContain("2026-10-17,Sat,PTO,,,,,,8.00");
    expect(lines).toContain("2026-10-18,Sun,Sick,,,,,,4.50");
  });
});
