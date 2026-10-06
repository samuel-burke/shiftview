import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

// Template rows use day_of_week 0 = Sunday … 6 = Saturday.
function makeClient(rows: Record<string, unknown>[], existing: Record<string, unknown>[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const chain = (result: unknown) => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
    b.maybeSingle = vi.fn().mockResolvedValue({ data: result, error: null });
    b.then = (res: any, rej: any) => Promise.resolve({ data: result, error: null }).then(res, rej);
    return b;
  };
  const client = {
    inserted,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return chain({ user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false });
      if (table === "employees") return chain(null);
      if (table === "schedule_templates") return chain({ id: 1, name: "Standard week" });
      if (table === "schedule_template_rows") return chain(rows);
      if (table === "schedules") {
        const b = chain(existing);
        b.insert = vi.fn().mockImplementation((r: Record<string, unknown>[]) => {
          inserted.push(...r);
          return Promise.resolve({ error: null });
        });
        return b;
      }
      return chain(null);
    }),
  };
  return client;
}

function apply(weekStartDate: string) {
  return POST(
    new Request("http://localhost/api/templates/1/apply", { method: "POST", body: JSON.stringify({ weekStartDate }) }),
    { params: Promise.resolve({ id: "1" }) }
  );
}

const SUN = { employee_id: 1, day_of_week: 0, start_minutes: 480, end_minutes: 960 };
const MON = { employee_id: 1, day_of_week: 1, start_minutes: 540, end_minutes: 1020 };
const SAT = { employee_id: 2, day_of_week: 6, start_minutes: 600, end_minutes: 1080 };

beforeEach(() => mockCreateClient.mockReset());

describe("POST /api/templates/[id]/apply", () => {
  it("puts day 0 on Sunday, 1 on Monday, 6 on Saturday — for a Monday-start week", async () => {
    const client = makeClient([SUN, MON, SAT]);
    mockCreateClient.mockResolvedValue(client as any);
    const res = await apply("2026-10-05"); // Monday
    expect(res.status).toBe(200);
    expect(client.inserted.map((r) => [r.date, r.start_minutes])).toEqual([
      ["2026-10-11", 480], // Sunday at the end of a Mon–Sun week
      ["2026-10-05", 540], // Monday
      ["2026-10-10", 600], // Saturday
    ]);
  });

  it("works for a week starting on any day (here a Saturday)", async () => {
    const client = makeClient([SUN, MON, SAT]);
    mockCreateClient.mockResolvedValue(client as any);
    const res = await apply("2026-10-03"); // Saturday
    expect(res.status).toBe(200);
    expect(client.inserted.map((r) => r.date)).toEqual(["2026-10-04", "2026-10-05", "2026-10-03"]);
  });

  it("skips employees who already have a shift that day", async () => {
    const client = makeClient([SUN, MON], [{ employee_id: 1, date: "2026-10-05" }]);
    mockCreateClient.mockResolvedValue(client as any);
    const body = await (await apply("2026-10-05")).json();
    expect(body).toEqual({ created: 1, skipped: 1 });
    expect(client.inserted.map((r) => r.date)).toEqual(["2026-10-11"]);
  });

  it("rejects malformed and impossible dates", async () => {
    mockCreateClient.mockResolvedValue(makeClient([SUN]) as any);
    expect((await apply("10/05/2026")).status).toBe(400);
    expect((await apply("2026-02-30")).status).toBe(400);
  });

  it("stamps the org on every inserted shift", async () => {
    const client = makeClient([MON]);
    mockCreateClient.mockResolvedValue(client as any);
    await apply("2026-10-05");
    expect(client.inserted[0]).toMatchObject({ org_id: MOCK_ORG_ID, employee_id: 1 });
  });
});
