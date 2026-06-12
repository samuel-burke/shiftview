import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLog } from "@/lib/audit";

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
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

const MOCK_USER = { id: "user-123", email: "founder@test.com", is_anonymous: false };
const NEW_ORG_ID = "11111111-2222-3333-4444-555555555555";

function makeServerClient(user: any = MOCK_USER) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

function makeAdminClient({
  ownedCount = 0,
  rpc = vi.fn().mockResolvedValue({ data: NEW_ORG_ID, error: null }),
} = {}) {
  const countBuilder: any = {};
  for (const m of ["select", "eq"]) {
    countBuilder[m] = vi.fn().mockReturnValue(countBuilder);
  }
  countBuilder.then = (resolve: any, reject: any) =>
    Promise.resolve({ count: ownedCount, data: null, error: null }).then(resolve, reject);
  return {
    from: vi.fn().mockReturnValue(countBuilder),
    rpc,
  };
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue(makeServerClient() as any);
  mockCreateAdminClient.mockReturnValue(makeAdminClient() as any);
  mockWriteAuditLog.mockResolvedValue(undefined);
});

// ── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/organizations — validation", () => {
  it("returns 400 when organization name is missing", async () => {
    const res = await POST(postReq({ ownerName: "Alice Smith" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("organization name") });
  });

  it("returns 400 when organization name is blank whitespace", async () => {
    const res = await POST(postReq({ name: "   ", ownerName: "Alice Smith" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when organization name is too long", async () => {
    const res = await POST(postReq({ name: "x".repeat(81), ownerName: "Alice Smith" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when owner name is missing", async () => {
    const res = await POST(postReq({ name: "Acme Coffee" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("name") });
  });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("POST /api/organizations — auth", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient(null) as any);
    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for anonymous (demo) users", async () => {
    mockCreateClient.mockResolvedValue(
      makeServerClient({ id: "anon-1", email: undefined, is_anonymous: true }) as any
    );
    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for users without an email address", async () => {
    mockCreateClient.mockResolvedValue(
      makeServerClient({ id: "user-9", email: undefined, is_anonymous: false }) as any
    );
    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the user already owns the maximum number of orgs", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ ownedCount: 3 }) as any);
    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("maximum") });
  });
});

// ── Provisioning ─────────────────────────────────────────────────────────────

describe("POST /api/organizations — provisioning", () => {
  it("creates the org via org_signup_create with the caller as owner", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: NEW_ORG_ID, error: null });
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ rpc }) as any);

    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "  alice smith  " }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, organizationId: NEW_ORG_ID });
    expect(rpc).toHaveBeenCalledWith("org_signup_create", {
      p_name: "Acme Coffee",
      p_slug: "acme-coffee",
      p_user_id: MOCK_USER.id,
      p_owner_name: "alice smith",
      p_owner_email: MOCK_USER.email,
    });
  });

  it("writes an organization.create audit log", async () => {
    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));
    expect(res.status).toBe(201);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "organization.create", orgId: NEW_ORG_ID, actorId: MOCK_USER.id })
    );
  });

  it("retries with a suffixed slug when the slug is already taken", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: 'duplicate key value violates unique constraint "organizations_slug_key"' },
      })
      .mockResolvedValueOnce({ data: NEW_ORG_ID, error: null });
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ rpc }) as any);

    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_slug).toMatch(/^acme-coffee-/);
  });

  it("returns 409 instead of retrying when a non-slug unique constraint fires", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "employees_email_key"' },
    });
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ rpc }) as any);

    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));

    expect(res.status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("already linked") });
  });

  it("never hands out reserved slugs unsuffixed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: NEW_ORG_ID, error: null });
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ rpc }) as any);

    const res = await POST(postReq({ name: "Demo", ownerName: "Alice Smith" }));

    expect(res.status).toBe(201);
    expect(rpc.mock.calls[0][1].p_slug).toMatch(/^demo-/);
  });

  it("returns 500 on a non-collision database error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "db down" } });
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ rpc }) as any);

    const res = await POST(postReq({ name: "Acme Coffee", ownerName: "Alice Smith" }));

    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
