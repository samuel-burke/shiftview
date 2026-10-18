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
    // Managers get rates from employee_pay_rates; the roster query never selects them.
    const manager = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryData: MOCK_EMPLOYEES,
      rpcData: [{ employee_id: 1, pay_rate: "18.50" }],
    });
    mockCreateClient.mockResolvedValue(manager as any);
    const managerView = await (await GET(new Request("http://localhost/api/employees"))).json();
    expect(manager.rpc).toHaveBeenCalledWith("employee_pay_rates", { p_org: MOCK_ORG_ID });
    expect(managerView.find((e: any) => e.id === 1)).toHaveProperty("pay_rate", 18.5);
    expect(managerView.find((e: any) => e.id === 2)).toHaveProperty("pay_rate", null);

    // An employee: their own membership row resolves the org, the roster
    // query returns the list.
    const employee = makeSupabaseClient({ user: MOCK_USER, isManager: false });
    const roster = makeQueryBuilder({ data: MOCK_EMPLOYEES, error: null });
    roster.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
    const fallback = employee.from.getMockImplementation()!;
    employee.from.mockImplementation((table: string) => (table === "employees" ? roster : fallback(table)));
    mockCreateClient.mockResolvedValue(employee as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    const employeeView = await res.json();
    expect(employeeView).toHaveLength(2);
    expect(employeeView[0]).not.toHaveProperty("pay_rate");
    expect(employeeView[0]).not.toHaveProperty("payroll_id");
    expect(employee.rpc).not.toHaveBeenCalled();
  });

  it("includes payroll IDs for managers, read through employee_payroll_ids", async () => {
    const manager = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    manager.rpc = vi.fn((fn: string) =>
      Promise.resolve(
        fn === "employee_payroll_ids"
          ? { data: [{ employee_id: 1, payroll_id: "G-1" }, { employee_id: 2, payroll_id: null }], error: null }
          : { data: [], error: null }
      )
    ) as any;
    mockCreateClient.mockResolvedValue(manager as any);
    const view = await (await GET(new Request("http://localhost/api/employees"))).json();
    expect(manager.rpc).toHaveBeenCalledWith("employee_payroll_ids", { p_org: MOCK_ORG_ID });
    expect(view.find((e: any) => e.id === 1)).toHaveProperty("payroll_id", "G-1");
    expect(view.find((e: any) => e.id === 2)).toHaveProperty("payroll_id", null);
  });

  it("still returns the roster when payroll IDs can't be read (before migration 0061)", async () => {
    const manager = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    manager.rpc = vi.fn((fn: string) =>
      Promise.resolve(
        fn === "employee_payroll_ids"
          ? { data: null, error: { code: "PGRST202", message: "no function" } }
          : { data: [{ employee_id: 1, pay_rate: 20 }], error: null }
      )
    ) as any;
    mockCreateClient.mockResolvedValue(manager as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.find((e: any) => e.id === 1)).toMatchObject({ pay_rate: 20, payroll_id: null });
  });

  it("never selects payroll_id from employees (it isn't in the API grant)", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/employees"));
    for (const r of client.from.mock.results)
      for (const [cols] of r.value.select.mock.calls) expect(String(cols)).not.toContain("payroll_id");
  });

  it("never selects pay_rate from employees", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/employees"));
    const builders = client.from.mock.results.map((r: any) => r.value);
    for (const b of builders)
      for (const [cols] of b.select.mock.calls) expect(String(cols)).not.toContain("pay_rate");
  });

  it("returns 500 when manager pay rates can't be read", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES, rpcError: { message: "boom" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(500);
  });

  it("returns the employee list sorted by last name", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual(MOCK_EMPLOYEES_SORTED.map((e) => ({ ...e, pay_rate: null, payroll_id: null })));
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
      { id: 1, name: "Alice Smith", employment_type: "part_time", min_weekly_hours: 12, max_weekly_hours: 24.5, max_days_per_week: 4, pay_rate: null, payroll_id: null },
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
    expect(await res.json()).toEqual(MOCK_EMPLOYEES_SORTED.map((e) => ({ ...e, pay_rate: null, payroll_id: null })));
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

  // ── Payroll ID (migration 0061) ─────────────────────────────────────────────

  function employeeUpdate(client: ReturnType<typeof makeSupabaseClient>) {
    for (const r of (client.from as ReturnType<typeof vi.fn>).mock.results) {
      const calls = (r.value.update as ReturnType<typeof vi.fn>).mock.calls;
      if (calls.length) return calls[0][0];
    }
    return undefined;
  }

  it("saves a payroll ID, trimmed", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, payrollId: "  ADP-0042 " }));
    expect(res.status).toBe(200);
    expect(employeeUpdate(client)).toEqual({ payroll_id: "ADP-0042" });
  });

  it("clears a payroll ID with null or blank", async () => {
    for (const payrollId of [null, "   "]) {
      const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
      mockCreateClient.mockResolvedValue(client as any);
      expect((await PATCH(patchReq({ id: 1, payrollId }))).status).toBe(200);
      expect(employeeUpdate(client)).toEqual({ payroll_id: null });
    }
  });

  it("refuses a payroll ID that is too long, not text, or has a tab (it would split an export record)", async () => {
    for (const payrollId of ["x".repeat(41), 42, "a\tb", "a\nb"]) {
      const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
      mockCreateClient.mockResolvedValue(client as any);
      const res = await PATCH(patchReq({ id: 1, payrollId }));
      expect(res.status).toBe(400);
      expect(employeeUpdate(client)).toBeUndefined();
    }
  });

  it("refuses a payroll ID change from an employee", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: false });
    mockCreateClient.mockResolvedValue(client as any);
    expect((await PATCH(patchReq({ id: 1, payrollId: "X" }))).status).toBe(403);
    expect(employeeUpdate(client)).toBeUndefined();
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
  // ── Archive or delete ───────────────────────────────────────────────────────
  // employee_remove (migration 0054) decides: anyone with history is archived,
  // a mistaken add with none is deleted.

  it("archives an employee with history and keeps their account", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      linkedEmployee: { id: 1, user_id: "other-user-456" },
      rpcData: "archived",
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });
    expect(client.rpc).toHaveBeenCalledWith("employee_remove", { p_org: MOCK_ORG_ID, p_employee: 1 });
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    // The route itself deletes nothing: no employee row, no shifts.
    for (const r of client.from.mock.results) expect(r.value.delete).not.toHaveBeenCalled();
  });

  it("treats an already archived employee as archived", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, user_id: null }, rpcData: "already_archived" }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });
  });

  it("deletes an employee with no history outright", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, user_id: null }, rpcData: "deleted" }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });
  });

  it("deletes the auth account of a deleted employee's last membership", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, user_id: "other-user-456" }, rpcData: "deleted" }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith("other-user-456");
  });

  it("keeps the account when the user still belongs to another organization", async () => {
    const adminClient = makeAdminClient({ memberships: 1 });
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, user_id: "other-user-456" }, rpcData: "deleted" }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("never removes another demo visitor's account", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        orgId: DEMO_ORG_ID,
        linkedEmployee: { id: 1, user_id: "other-visitor" },
        rpcData: "deleted",
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(adminClient.from).not.toHaveBeenCalledWith("managers");
    expect(adminClient.from).not.toHaveBeenCalledWith("employees");
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("does not call the admin client when employee has no linked user", async () => {
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, user_id: null }, rpcData: "deleted" }) as any
    );
    await DELETE(deleteReq({ id: 1 }));
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  // ── Database errors ─────────────────────────────────────────────────────────

  it.each([
    ["P0002", 404],
    ["42501", 403],
    ["23503", 409],
    [undefined, 500],
  ])("maps employee_remove error %s to %i", async (code, status) => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 1, user_id: null },
        rpcError: { code, message: "boom" },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(status);
  });
});

// ── Archived employees: roster and restore ──────────────────────────────────

describe("archived employees", () => {
  function patchReq(body: unknown) {
    return new Request("http://localhost/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  // The roster query: the employees builder that selected archived_at.
  function rosterBuilder(client: ReturnType<typeof makeSupabaseClient>) {
    return client.from.mock.results
      .map((r: any) => r.value)
      .find((b: any) => b.select.mock.calls.some(([cols]: [string]) => String(cols).includes("archived_at")));
  }

  it("leaves archived employees out of the roster by default", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/employees"));
    expect(rosterBuilder(client).is).toHaveBeenCalledWith("archived_at", null);
  });

  it("includes them for a manager who asks (reports, restore)", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/employees?include=archived"));
    expect(rosterBuilder(client).is).not.toHaveBeenCalledWith("archived_at", null);
  });

  it("never includes them for a non-manager", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: false });
    const roster = makeQueryBuilder({ data: MOCK_EMPLOYEES, error: null });
    roster.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
    const fallback = client.from.getMockImplementation()!;
    client.from.mockImplementation((table: string) => (table === "employees" ? roster : fallback(table)));
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/employees?include=archived"));
    expect(roster.is).toHaveBeenCalledWith("archived_at", null);
    // Only the membership lookup and the roster: both filter.
    expect(roster.is.mock.calls.every(([col, v]: [string, unknown]) => col === "archived_at" && v === null)).toBe(true);
  });

  it("restores an archived employee with archived: false", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryData: { id: 1, name: "Alice Smith", email: null, user_id: null, archived_at: "2026-10-01T00:00:00Z" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, archived: false }));
    expect(res.status).toBe(200);
    const updates = client.from.mock.results
      .map((r: any) => r.value.update.mock.calls[0]?.[0])
      .find(Boolean);
    expect(updates).toEqual({ archived_at: null });
  });

  it("refuses archived: true (archiving goes through DELETE)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PATCH(patchReq({ id: 1, archived: true }));
    expect(res.status).toBe(400);
  });

  it("only managers restore", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any);
    const res = await PATCH(patchReq({ id: 1, archived: false }));
    expect(res.status).toBe(403);
  });
});
