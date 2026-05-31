import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { makeSupabaseClient, MOCK_USER } from "../../__tests__/helpers";

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

function makeAdminClient(result: { data?: any[]; error?: { message: string } | null } = {}) {
  const { data = [{ user_id: "target-user-abc" }], error = null } = result;
  const builder: any = {};
  for (const m of ["upsert", "delete", "eq", "select"]) builder[m] = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ data, error }).then(resolve, reject);
  return { from: vi.fn().mockReturnValue(builder) };
}

function putReq(userId: string, body: unknown) {
  return [
    new Request(`http://localhost/api/managers/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId }) },
  ] as const;
}

const TARGET_USER = "target-user-abc";

describe("PUT /api/managers/:userId", () => {
  beforeEach(() => {
    mockCreateAdminClient.mockReturnValue(makeAdminClient() as any);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 for missing or invalid action", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const [req, ctx] = putReq(TARGET_USER, { action: "invalid" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("action") });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(403);
  });

  // ── Self-demotion guard ────────────────────────────────────────────────────

  it("returns 400 when a manager tries to demote themselves", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const [req, ctx] = putReq(MOCK_USER.id, { action: "demote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("demote yourself") });
  });

  it("allows a manager to promote themselves (no self-promotion restriction)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const [req, ctx] = putReq(MOCK_USER.id, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
  });

  // ── Promote ────────────────────────────────────────────────────────────────

  it("promotes a user and returns 200", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(adminClient.from).toHaveBeenCalledWith("managers");
  });

  it("returns 500 when promote is silently blocked (0 rows returned)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ data: [] }) as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Promote failed") });
  });

  // ── Demote ─────────────────────────────────────────────────────────────────

  it("demotes a different user and returns 200", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const adminClient = makeAdminClient();
    mockCreateAdminClient.mockReturnValue(adminClient as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "demote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 500 when demote is silently blocked (0 rows deleted)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ data: [] }) as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "demote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Demote failed") });
  });

  // ── Missing service role key ───────────────────────────────────────────────

  it("returns 500 when SUPABASE_SERVICE_ROLE_KEY is not configured", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    });

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY") });
  });

  // ── DB error ────────────────────────────────────────────────────────────────

  it("returns 500 on database error during promote", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({ data: undefined, error: { message: "db error" } }) as any
    );

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(500);
  });
});
