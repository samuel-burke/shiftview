// The payroll export's PTO and sick columns (migration 0064): paid leave is
// paid, but it is not time worked and never pushes a week into overtime.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase-server";
import { fakeSupabase } from "../../../__tests__/fake-supabase";
import { MOCK_ORG_ID } from "../../../__tests__/helpers";
import { GET } from "./route";
import { GET as GET_REPORT } from "../route";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const ORG = MOCK_ORG_ID;
const OTHER = "00000000-0000-0000-0000-0000000000ff";
// Ann: 10 h Mon–Thu Oct 5–8 2026 (EDT) = 40 h, then PTO Friday.
const PUNCHES = ["05", "06", "07", "08"].flatMap((d, i) => [
  { id: i * 2 + 1, org_id: ORG, employee_id: 1, punch_type: "clock_in", punched_at: `2026-10-${d}T13:00:00.000Z`, employees: { name: "Ann" } },
  { id: i * 2 + 2, org_id: ORG, employee_id: 1, punch_type: "clock_out", punched_at: `2026-10-${d}T23:00:00.000Z`, employees: { name: "Ann" } },
]);

function world(userId: string, pageCap = 1000) {
  const c = fakeSupabase({
    userId,
    pageCap,
    tables: {
      managers: [{ user_id: "mgr", org_id: ORG, is_owner: true }],
      employees: [
        { id: 1, org_id: ORG, user_id: "emp1", name: "Ann" },
        { id: 2, org_id: ORG, user_id: null, name: "Bob" },
      ],
      app_settings: [{ org_id: ORG, key: "timezone", value: "America/New_York" }],
      punch_records: PUNCHES,
      time_off_requests: [
        { id: 1, org_id: ORG, employee_id: 1, date: "2026-10-09", status: "approved", leave_type: "pto", paid_hours: "8.00" },
        { id: 2, org_id: ORG, employee_id: 2, date: "2026-10-06", status: "approved", leave_type: "sick", paid_hours: "6.00" },
        { id: 3, org_id: ORG, employee_id: 2, date: "2026-10-07", status: "pending", leave_type: "pto", paid_hours: "8.00" },
        { id: 4, org_id: ORG, employee_id: 2, date: "2026-10-08", status: "cancelled", leave_type: "pto", paid_hours: "8.00" },
        { id: 5, org_id: ORG, employee_id: 1, date: "2026-10-12", status: "approved", leave_type: "pto", paid_hours: "8.00" },
        { id: 6, org_id: OTHER, employee_id: 9, date: "2026-10-06", status: "approved", leave_type: "pto", paid_hours: "8.00" },
      ],
    },
  });
  vi.mocked(createClient).mockResolvedValue(c as any);
  return c;
}

const exportCsv = async (format: string) =>
  (await (await GET(new Request(`http://localhost/api/reports/payroll/export?from=2026-10-05&to=2026-10-11&format=${format}`))).text()).split("\n");

beforeEach(() => vi.clearAllMocks());

describe("payroll export — PTO columns", () => {
  it("summary: PTO and sick columns at the end; PTO isn't overtime", async () => {
    world("mgr");
    const lines = await exportCsv("summary");
    expect(lines[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete,PTO Hrs,Sick Hrs");
    expect(lines).toContain("Ann,2026-10-05,40.00,0.00,0.00,40.00,,8.00,0.00");
    // Bob has only a sick day: he still appears, with no worked hours.
    expect(lines).toContain("Bob,2026-10-05,0.00,0.00,0.00,0.00,,0.00,6.00");
    // Pending, cancelled, other-org and out-of-range days are left out.
    expect(lines).toHaveLength(3);
  });

  it("daily: a leave-only day gets its own row", async () => {
    world("mgr");
    const lines = await exportCsv("daily");
    expect(lines[0]).toBe("Employee,Date,Day,Hours Worked,Break Hours,Incomplete,PTO Hrs,Sick Hrs");
    expect(lines).toContain("Ann,2026-10-09,Fri,0.00,0.00,,8.00,0.00");
    expect(lines).toContain("Ann,2026-10-05,Mon,10.00,0.00,,0.00,0.00");
    expect(lines).toContain("Bob,2026-10-06,Tue,0.00,0.00,,0.00,6.00");
  });

  it("detailed: PTO doesn't add to the cumulative hours toward overtime", async () => {
    world("mgr");
    const lines = await exportCsv("detailed");
    expect(lines[0].endsWith(",Incomplete,PTO Hrs,Sick Hrs")).toBe(true);
    expect(lines).toContain("Ann,2026-10-05,2026-10-09,Fri,0.00,40.00,0.00,0.00,0.00,,8.00,0.00");
    expect(lines).toContain("Ann — week total,2026-10-05,,,40.00,,40.00,0.00,0.00,,8.00,0.00");
  });

  it("QuickBooks IIF: PTO and Sick time types", async () => {
    world("mgr");
    const lines = await exportCsv("qb-iif");
    expect(lines).toContain("TIMETYPE\tPTO");
    expect(lines).toContain("TIMETYPE\tSick");
    expect(lines).toContain("TIMEACT\t10/09/2026\t\tAnn\tPTO\t8.00\t\t0\t\t");
    expect(lines).toContain("TIMEACT\t10/06/2026\t\tBob\tSick\t6.00\t\t0\t\t");
    expect(lines.filter((l) => l.startsWith("TIMEACT") && l.includes("\tOvertime\t"))).toEqual([]);
  });

  it("reads approved leave page by page (more than one API page)", async () => {
    world("mgr", 1);
    const lines = await exportCsv("summary");
    expect(lines).toContain("Ann,2026-10-05,40.00,0.00,0.00,40.00,,8.00,0.00");
    expect(lines).toContain("Bob,2026-10-05,0.00,0.00,0.00,0.00,,0.00,6.00");
  });

  it("an employee cannot export", async () => {
    world("emp1");
    expect((await GET(new Request("http://localhost/api/reports/payroll/export?from=2026-10-05&to=2026-10-11"))).status).toBe(403);
  });

  it("the payroll report carries the same PTO hours", async () => {
    world("mgr");
    const body = await (await GET_REPORT(new Request("http://localhost/api/reports/payroll?from=2026-10-05&to=2026-10-11"))).json();
    const ann = body.rows.find((r: any) => r.employeeName === "Ann");
    expect(ann).toMatchObject({ totalWorkedHours: 40, totalOvertimeHours: 0, totalPtoHours: 8, totalSickHours: 0 });
    expect(body.rows.find((r: any) => r.employeeName === "Bob")).toMatchObject({ totalSickHours: 6 });
  });
});
