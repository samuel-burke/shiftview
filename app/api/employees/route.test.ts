import { describe, it, expect, vi } from "vitest";
import { GET, PATCH } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
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

const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/employees", () => {
  it("queries employees_demo for unauthenticated users", async () => {
    const client = makeSupabaseClient({ user: null, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees_demo");
  });

  it("queries employees for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees");
  });

  it("returns the employee list", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual(MOCK_EMPLOYEES);
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
