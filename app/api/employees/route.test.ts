import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";
import { DEMO_EMPLOYEES } from "@/data/demo-fixtures";

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

function makeAdminClient() {
  const builder: any = {};
  for (const m of ["delete", "eq"]) builder[m] = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ error: null }).then(resolve, reject);
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
  it("returns demo employees from fixtures for unauthenticated users without hitting DB", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("employees_demo");
    const body = await res.json();
    expect(body.map((e: { name: string }) => e.name)).toEqual(
      expect.arrayContaining(DEMO_EMPLOYEES.map((e) => e.name))
    );
  });

  it("queries employees for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees");
  });

  it("returns the employee list sorted by last name", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual(MOCK_EMPLOYEES_SORTED);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryError: { message: "db error" } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(500);
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

  it("links a user to an employee and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, userId: "user-abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.from).toHaveBeenCalledWith("employees");
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

  // ── DB error ────────────────────────────────────────────────────────────────

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PATCH(patchReq({ id: 1, userId: "user-abc" }));
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
