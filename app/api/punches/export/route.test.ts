import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

// punch_records serves at most `cap` rows per request (Supabase's max rows).
function makeClient(punches: any[], cap = 1000) {
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
    b.range = vi.fn((from: number, to: number) =>
      Promise.resolve({ data: punches.slice(from, Math.min(to + 1, from + cap)), error: null }));
    b.then = (resolve: any, reject: any) =>
      Promise.resolve({ data: table === "app_settings" ? [{ key: "timezone", value: "America/New_York" }] : [], error: null })
        .then(resolve, reject);
    return b;
  };
  return { from: vi.fn().mockImplementation(builder) };
}

function asManager(punches: any[], cap?: number) {
  vi.mocked(createClient).mockResolvedValue(makeClient(punches, cap) as any);
  vi.mocked(getOrgContext).mockResolvedValue({
    ctx: { orgId: "org", user: { id: "u" }, isManager: true, employeeId: null },
    error: null,
  } as any);
}

let nextId = 1;
const punch = (punch_type: string, punched_at: string, note: string | null = null) => ({
  id: nextId++, employee_id: 1, punch_type, punched_at, is_manual: !!note, note, lat: null, lng: null,
  employees: { name: "Ann" },
});

const req = (qs: string) => new Request(`http://localhost/api/punches/export?${qs}`);

describe("GET /api/punches/export — timekeeping audit regressions", () => {
  it("tells the two 1:30 AMs of a fall-back night apart", async () => {
    // Nov 1 2026, New York: 1:30 AM EDT (05:30Z), then 1:30 AM EST (06:30Z).
    asManager([punch("clock_in", "2026-11-01T05:30:00.000Z"), punch("clock_out", "2026-11-01T06:30:00.000Z")]);
    const lines = (await (await GET(req("from=2026-11-01&to=2026-11-01"))).text()).split("\n");
    expect(lines[0].endsWith(",Timestamp (UTC)")).toBe(true);
    expect(lines[1]).toBe("Ann,2026-11-01,01:30:00 AM,clock_in,no,,,,2026-11-01T05:30:00.000Z");
    expect(lines[2]).toBe("Ann,2026-11-01,01:30:00 AM,clock_out,no,,,,2026-11-01T06:30:00.000Z");
  });

  it("exports every punch past the API's row cap", async () => {
    const punches = Array.from({ length: 25 }, (_, i) =>
      punch(i % 2 ? "clock_out" : "clock_in", new Date(Date.UTC(2026, 5, 1, 12) + i * 3_600_000).toISOString()));
    asManager(punches, 10);
    const lines = (await (await GET(req("from=2026-06-01&to=2026-06-03"))).text()).split("\n");
    expect(lines).toHaveLength(26);
  });

  it("defuses a formula an employee typed into a correction note", async () => {
    asManager([punch("clock_in", "2026-06-01T13:00:00.000Z", '=HYPERLINK("http://evil","x")')]);
    const row = (await (await GET(req("from=2026-06-01&to=2026-06-01"))).text()).split("\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});
