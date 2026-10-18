import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase-admin";
import { DEMO_ORG_ID } from "@/lib/demo-org";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCron: vi.fn(() => true) }));
vi.mock("@/lib/demo-seed", () => ({ seedDemoOrg: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/ntfy", () => ({ sendNtfy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

function admin(rpcErrors: Record<string, unknown> = {}) {
  const b: any = {};
  for (const m of ["select", "eq", "not"]) b[m] = vi.fn().mockReturnValue(b);
  b.then = (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej);
  return {
    from: vi.fn(() => b),
    rpc: vi.fn(async (fn: string) => ({ data: null, error: rpcErrors[fn] ?? null })),
    auth: { admin: { getUserById: vi.fn(), deleteUser: vi.fn() } },
  };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("GET /api/cron/demo-reset and pay periods", () => {
  it("clears the demo's pay periods after the reset, so a demo lock can't outlive it", async () => {
    const client = admin();
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await GET(new Request("http://localhost/api/cron/demo-reset"));
    expect(res.status).toBe(200);
    expect(client.rpc.mock.calls.map((c) => c[0])).toEqual(["reset_demo_org", "pay_periods_reset_demo"]);
    expect(client.rpc).toHaveBeenCalledWith("pay_periods_reset_demo", { p_org: DEMO_ORG_ID });
  });

  it("fails loudly when the pay periods can't be cleared", async () => {
    const client = admin({ pay_periods_reset_demo: { message: "boom" } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await GET(new Request("http://localhost/api/cron/demo-reset"));
    expect(res.status).toBe(500);
  });
});
