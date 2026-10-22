// The exempt (salaried, no overtime) flag on employees: managers read and set
// it; nobody else does. Migration 0060 adds the column.

import { describe, it, expect, vi } from "vitest";
import { GET, PATCH } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder, makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
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
const EMPLOYEES = [{ id: 1, name: "Alice Smith", exempt: true }];

// The columns each employees select asked for; `missing` makes a select that
// names that column fail as an undefined column.
function withSelects(client: ReturnType<typeof makeSupabaseClient>, missing?: string) {
  const selects: string[] = [];
  const original = client.from.getMockImplementation()!;
  client.from.mockImplementation((table: string) => {
    const builder = original(table);
    if (table === "employees") {
      const select = builder.select;
      builder.select = vi.fn((columns: string) => {
        if (columns.includes("archived_at")) selects.push(columns); // the roster, not org lookups
        return missing && columns.includes(missing)
          ? makeQueryBuilder({ data: null, error: { code: "42703", message: `column ${missing} does not exist` } })
          : select(columns);
      });
    }
    return builder;
  });
  return selects;
}

const patchReq = (body: unknown) =>
  new Request("http://localhost/api/employees", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function updateCall(client: ReturnType<typeof makeSupabaseClient>) {
  for (const r of (client.from as ReturnType<typeof vi.fn>).mock.results) {
    const calls = (r.value.update as ReturnType<typeof vi.fn>).mock.calls;
    if (calls.length) return { args: calls[0][0], builder: r.value };
  }
  return undefined;
}

describe("GET /api/employees — exempt", () => {
  it("includes exempt for managers", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: EMPLOYEES });
    const selects = withSelects(client);
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(selects[0]).toContain("exempt");
    expect((await res.json())[0]).toMatchObject({ id: 1, exempt: true });
  });

  it("doesn't select it for other members", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: false, queryData: [{ id: 1, name: "Alice Smith" }] });
    const original = client.from.getMockImplementation()!;
    // A plain member: no manager row, but an employee row for org context.
    client.from.mockImplementation((table: string) =>
      table === "employees" && !(client.from as any)._seenEmployee
        ? ((client.from as any)._seenEmployee = true, makeQueryBuilder({ data: { id: 9, org_id: MOCK_ORG_ID }, error: null }))
        : original(table));
    const selects = withSelects(client);
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((c) => !c.includes("exempt"))).toBe(true);
  });

  it("keeps the roster working before migration 0060", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: [{ id: 1, name: "Alice Smith" }] });
    const selects = withSelects(client, "exempt");
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("exempt");
    expect(selects[1]).toContain("employment_type");
  });
});

describe("PATCH /api/employees — exempt", () => {
  it("lets a manager mark an employee exempt, in their own org", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, exempt: true }));
    expect(res.status).toBe(200);
    const call = updateCall(client)!;
    expect(call.args).toEqual({ exempt: true });
    expect(call.builder.eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
    expect(call.builder.eq).toHaveBeenCalledWith("id", 1);
  });

  it("lets a manager clear it", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    expect((await PATCH(patchReq({ id: 1, exempt: false }))).status).toBe(200);
    expect(updateCall(client)!.args).toEqual({ exempt: false });
  });

  it.each([["yes"], [1], [null]])("rejects exempt = %j", async (exempt) => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, exempt }));
    expect(res.status).toBe(400);
    expect(updateCall(client)).toBeUndefined();
  });

  it("refuses non-managers (an employee can't mark themselves exempt)", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: false, linkedEmployee: { id: 1 } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, exempt: true }));
    expect(res.status).toBe(403);
    expect(updateCall(client)).toBeUndefined();
  });
});
