import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder, makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
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

// Monday Oct 12 – Sunday Oct 18, 2026; 9 AM – 6 PM EDT (13:00–22:00 UTC)
// Monday to Friday is 45 hours: 40 regular, 5 overtime.
const WEEK = "from=2026-10-12&to=2026-10-18";
const PUNCHES = ["12", "13", "14", "15", "16"].flatMap((d, i) => [
  { id: i * 2 + 1, punch_type: "clock_in", punched_at: `2026-10-${d}T13:00:00Z`, is_manual: false, note: null },
  { id: i * 2 + 2, punch_type: "clock_out", punched_at: `2026-10-${d}T22:00:00Z`, is_manual: false, note: null },
]);

// The client from makeSupabaseClient, with punch_records answering page by
// page (fetchAllRows reads until an empty page) and every other table empty.
function client(opts: Parameters<typeof makeSupabaseClient>[0]) {
  const base = makeSupabaseClient({ queryData: [], ...opts });
  const baseFrom = base.from.getMockImplementation()!;
  const punchQueries: Array<Record<string, any>> = [];
  base.from.mockImplementation((table: string) => {
    if (table !== "punch_records") return baseFrom(table);
    const b = makeQueryBuilder({ data: PUNCHES, error: null });
    punchQueries.push(b);
    b.range = vi.fn((first: number) => makeQueryBuilder({ data: first === 0 ? PUNCHES : [], error: null }));
    return b;
  });
  return { supabase: base, punchQueries };
}

const req = (qs: string) => new Request(`http://localhost/api/timecard?${qs}`);

describe("GET /api/timecard", () => {
  it("returns 401 when signed out", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).supabase as any);
    const res = await GET(req(`employeeId=5&${WEEK}`));
    expect(res.status).toBe(401);
  });

  describe("an employee", () => {
    const alex = { id: 5, name: "Alex Kim" };

    it("gets their own time card without naming themselves, with overtime split as payroll does", async () => {
      const { supabase, punchQueries } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(WEEK));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employeeId).toBe(5);
      expect(body.totalWorkedHours).toBe(45);
      expect(body.days).toHaveLength(5);
      expect(body.weeks).toEqual([
        expect.objectContaining({ weekStart: "2026-10-12", regularHours: 40, overtimeHours: 5, totalWorkedHours: 45 }),
      ]);
      // Scoped to the caller, whatever else the request said.
      expect(punchQueries[0].eq).toHaveBeenCalledWith("employee_id", 5);
      // No pay data in the response.
      expect(JSON.stringify(body)).not.toMatch(/pay_?rate/i);
    });

    it("gets their own time card when they name themselves", async () => {
      const { supabase } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=5&${WEEK}`));
      expect(res.status).toBe(200);
      expect((await res.json()).employeeId).toBe(5);
    });

    it("is refused another employee's time card", async () => {
      const { supabase, punchQueries } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}`));
      expect(res.status).toBe(403);
      expect(punchQueries).toHaveLength(0);
    });

    it("is refused another employee's CSV too", async () => {
      const { supabase } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}&format=csv`));
      expect(res.status).toBe(403);
    });
  });

  describe("a manager", () => {
    it("reads any employee in the org", async () => {
      const { supabase, punchQueries } = client({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 6, name: "Bo Diaz" },
      });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employeeId).toBe(6);
      expect(body.employeeName).toBe("Bo Diaz");
      expect(body.weeks[0]).toMatchObject({ overtimeHours: 5 });
      expect(punchQueries[0].eq).toHaveBeenCalledWith("employee_id", 6);
    });

    it("must name the employee", async () => {
      const { supabase } = client({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(WEEK));
      expect(res.status).toBe(400);
    });

    it("gets 404 for an employee outside the org", async () => {
      const { supabase } = client({ user: MOCK_USER, isManager: true, linkedEmployee: null });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=99&${WEEK}`));
      expect(res.status).toBe(404);
    });
  });
});
