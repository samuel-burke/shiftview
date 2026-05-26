import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

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

const MOCK_USER = { id: "user-123", email: "manager@test.com" };
const MOCK_NEW_EMPLOYEE = { id: 5 };

function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "order"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.single = vi.fn().mockResolvedValue(result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

function makeServerClient({
  user = MOCK_USER as any,
  isManager = true,
  insertData = MOCK_NEW_EMPLOYEE as any,
  insertError = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn()
      .mockReturnValueOnce(makeQueryBuilder({ data: managerRow, error: null }))       // managers
      .mockReturnValueOnce(makeQueryBuilder({ data: insertData, error: insertError })), // employees insert
  };
}

function makeAdminClient(inviteError: any = null) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue({ data: {}, error: inviteError }),
      },
    },
  };
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateAdminClient.mockReturnValue(makeAdminClient() as any);
});

// ── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/invites — validation", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(makeServerClient() as any);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(postReq({ email: "alice@example.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("returns 400 when name is blank whitespace", async () => {
    const res = await POST(postReq({ name: "   ", email: "alice@example.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(postReq({ name: "Alice Smith" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("email") });
  });

  it("returns 400 when email format is invalid", async () => {
    const res = await POST(postReq({ name: "Alice Smith", email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("email") });
  });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("POST /api/invites — auth", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient({ user: null }) as any);
    const res = await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient({ isManager: false }) as any);
    const res = await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));
    expect(res.status).toBe(403);
  });
});

// ── Business logic ───────────────────────────────────────────────────────────

describe("POST /api/invites — business logic", () => {
  it("returns 500 when the employee insert fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeServerClient({ insertError: { message: "duplicate email" } }) as any
    );
    const res = await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "duplicate email" });
  });

  it("returns 500 when the Supabase invite call fails", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient() as any);
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({ message: "User already registered" }) as any
    );
    const res = await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "User already registered" });
  });

  it("returns 201 with employeeId on success", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient() as any);
    const res = await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, employeeId: MOCK_NEW_EMPLOYEE.id });
  });

  it("trims whitespace from name before inserting", async () => {
    const client = makeServerClient();
    mockCreateClient.mockResolvedValue(client as any);

    await POST(postReq({ name: "  Alice Smith  ", email: "alice@example.com" }));

    const insertBuilder = client.from.mock.results[1].value;
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      name: "Alice Smith",
      email: "alice@example.com",
    });
  });

  it("sends the invite to the provided email", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient() as any);
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);

    await POST(postReq({ name: "Alice Smith", email: "alice@example.com" }));

    expect(adminClient.auth.admin.inviteUserByEmail).toHaveBeenCalledWith("alice@example.com");
  });
});
