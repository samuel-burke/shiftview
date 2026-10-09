import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { makeQueryBuilder, makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";
import { DEMO_ORG_ID } from "@/lib/demo-org";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
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
const mockCreateAdminClient = vi.mocked(createAdminClient);

// `memberships`: the deleted user's remaining managers/employees rows in
// other orgs, as each count query reports them.
function makeAdminClient({ memberships = 0 } = {}) {
  const builder: any = {};
  for (const m of ["delete", "select", "eq"]) builder[m] = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ error: null, count: memberships }).then(resolve, reject);
  return {
    from: vi.fn().mockReturnValue(builder),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
  };
}

const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];

const MOCK_EMPLOYEES_SORTED = [
  { id: 2, name: "Bob Jones" },
  { id: 1, name: "Alice Smith" },
];

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/employees", () => {
  it("returns 401 for unauthenticated users", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(401);
  });

  it("queries employees for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees");
  });

  it("includes pay rates for managers only", async () => {
    const withRates = MOCK_EMPLOYEES.map((e) => ({ ...e, pay_rate: 18 }));
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: withRates }) as any
    );
    const managerView = await (await GET(new Request("http://localhost/api/employees"))).json();
    expect(managerView[0]).toHaveProperty("pay_rate", 18);

    // An employee: their own membership row resolves the org, the roster
    // query returns the list.
    const employee = makeSupabaseClient({ user: MOCK_USER, isManager: false });
    const roster = makeQueryBuilder({ data: withRates, error: null });
    roster.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
    const fallback = employee.from.getMockImplementation()!;
    employee.from.mockImplementation((table: string) => (table === "employees" ? roster : fallback(table)));
    mockCreateClient.mockResolvedValue(employee as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    const employeeView = await res.json();
    expect(employeeView).toHaveLength(2);
    expect(employeeView[0]).not.toHaveProperty("pay_rate");
  });

  it("returns the employee list sorted by last name", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual(MOCK_EMPLOYEES_SORTED);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(500);
  });

  it("returns weekly hour limits as numbers", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryData: [{ id: 1, name: "Alice Smith", employment_type: "part_time", min_weekly_hours: "12.0", max_weekly_hours: "24.5", max_days_per_week: 4 }],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual([
      { id: 1, name: "Alice Smith", employment_type: "part_time", min_weekly_hours: 12, max_weekly_hours: 24.5, max_days_per_week: 4 },
    ]);
  });

  it("falls back to the base columns when the scheduling migration isn't applied", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    const original = client.from.getMockImplementation()!;
    client.from.mockImplementation((table: string) => {
      const builder = original(table);
      if (table === "employees") {
        const select = builder.select;
        builder.select = vi.fn((columns: string) =>
          columns.includes("employment_type")
            ? makeQueryBuilder({ data: null, error: { code: "42703", message: "column employees.employment_type does not exist" } })
            : select(columns)
        );
      }
      return builder;
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MOCK_EMPLOYEES_SORTED);
  });
});

// ── PATCH ────────────────────────────────────────────────────────────────────

describe("PATCH /api/employees", () => {
  function patchReq(body: unknown) {
    return new Request("http://localhost/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 when id is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ userId: "user-abc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("id") });
  });

  it("returns 400 when id is not an integer", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: "one", userId: "user-abc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("integer") });
  });

  it("returns 400 when userId is an invalid type", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, userId: 42 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("userId") });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PATCH(patchReq({ id: 1, userId: "user-abc" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PATCH(patchReq({ id: 1, userId: "user-abc" }));
    expect(res.status).toBe(403);
  });

  // ── Success ─────────────────────────────────────────────────────────────────

  it("links the manager's own account to an employee and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, userId: MOCK_USER.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.from).toHaveBeenCalledWith("employees");
  });

  it("returns 403 when linking someone else's account", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, userId: "someone-else" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("your own account") });
  });

  it("unlinks a user from an employee when userId is null", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, userId: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // ── Name update ─────────────────────────────────────────────────────────────

  it("returns 400 when name is an empty string", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, name: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("returns 400 when name is only whitespace", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, name: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither name nor userId is provided", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No fields") });
  });

  it("returns 200 when updating name only", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, name: "Alice Johnson" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // ── Pay rate ────────────────────────────────────────────────────────────────

  it("returns 200 when setting a pay rate", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, payRate: 18.5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 when clearing a pay rate with null", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, payRate: null }));
    expect(res.status).toBe(200);
  });

  it("returns 400 for a negative pay rate", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, payRate: -5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("payRate") });
  });

  it("returns 400 for a non-numeric pay rate", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, payRate: "20" }));
    expect(res.status).toBe(400);
  });

  // ── Employment type and weekly limits ───────────────────────────────────────

  function updateArgs(client: ReturnType<typeof makeSupabaseClient>) {
    for (const r of (client.from as ReturnType<typeof vi.fn>).mock.results) {
      const calls = (r.value.update as ReturnType<typeof vi.fn>).mock.calls;
      if (calls.length) return calls[0][0];
    }
    return undefined;
  }

  it("saves employment type and weekly limits", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, employmentType: "full_time", minWeeklyHours: 35, maxWeeklyHours: 40, maxDaysPerWeek: 5 }));
    expect(res.status).toBe(200);
    expect(updateArgs(client)).toEqual({
      employment_type: "full_time",
      min_weekly_hours: 35,
      max_weekly_hours: 40,
      max_days_per_week: 5,
    });
  });

  it("clears a limit back to the org default with null", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, maxWeeklyHours: null }));
    expect(res.status).toBe(200);
    expect(updateArgs(client)).toEqual({ max_weekly_hours: null });
  });

  it("returns 400 for an unknown employment type", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, employmentType: "seasonal" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("employmentType") });
  });

  it("returns 400 when a new minimum exceeds the stored maximum", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryData: { id: 1, name: "Alice Smith", min_weekly_hours: null, max_weekly_hours: "20.0" },
      }) as any
    );
    const res = await PATCH(patchReq({ id: 1, minWeeklyHours: 25 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "minWeeklyHours cannot exceed maxWeeklyHours" });
  });

  // ── DB error ────────────────────────────────────────────────────────────────

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, name: "Alice Smith" }));
    expect(res.status).toBe(500);
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/employees", () => {
  function deleteReq(body: unknown) {
    return new Request("http://localhost/api/employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mockCreateAdminClient.mockReturnValue(makeAdminClient() as any);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when id is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await DELETE(deleteReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("id") });
  });

  it("returns 400 when id is not an integer", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await DELETE(deleteReq({ id: "abc" }));
    expect(res.status).toBe(400);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(403);
  });

  // ── Business logic ──────────────────────────────────────────────────────────

  it("returns 404 when the employee does not exist", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: null }) as any
    );
    const res = await DELETE(deleteReq({ id: 99 }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when a manager tries to delete their own account", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the target employee is the organization owner", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        ownerUserId: "owner-user-789",
        linkedEmployee: { id: 1, user_id: "owner-user-789" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("owner") });
  });

  it("returns 403 when a non-owner manager deletes another manager in an owned org", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        ownerUserId: "owner-user-789",
        linkedEmployee: { id: 1, user_id: "other-manager-456" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("owner") });
  });

  it("returns 200 on success for an unlinked employee", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: null },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("deletes the auth account when the employee has a linked user", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: "other-user-456" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith("other-user-456");
  });

  it("keeps the account when the user still belongs to another organization", async () => {
    const adminClient = makeAdminClient({ memberships: 1 });
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: "other-user-456" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.from).toHaveBeenCalledWith("managers");
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("never removes another demo visitor's account or role", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        orgId: DEMO_ORG_ID,
        linkedEmployee: { id: 1, user_id: "other-visitor" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.from).not.toHaveBeenCalledWith("managers");
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("does not call the admin client when employee has no linked user", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: null },
      }) as any
    );
    await DELETE(deleteReq({ id: 1 }));
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  // ── DB error ────────────────────────────────────────────────────────────────

  it("returns 500 on database error during deletion", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: null },
        queryError: { message: "db error" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(500);
  });
});
