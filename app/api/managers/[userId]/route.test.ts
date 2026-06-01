import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../../__tests__/helpers";

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
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 for missing or invalid action", async () => {
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
    const [req, ctx] = putReq(MOCK_USER.id, { action: "demote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("demote yourself") });
  });

  it("allows a manager to promote themselves (no self-promotion restriction)", async () => {
    const [req, ctx] = putReq(MOCK_USER.id, { action: "promote" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
  });

  // ── Promote via RPC ────────────────────────────────────────────────────────

  it("calls manager_promote RPC with the target userId and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("manager_promote", { target_user_id: TARGET_USER });
  });

  it("returns 500 on RPC error during promote", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      rpcError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "promote" });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db error" });
  });

  // ── Demote via RPC ─────────────────────────────────────────────────────────

  it("calls manager_demote RPC with the target userId and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "demote" });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("manager_demote", { target_user_id: TARGET_USER });
  });

  it("returns 500 on RPC error during demote", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      rpcError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);

    const [req, ctx] = putReq(TARGET_USER, { action: "demote" });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db error" });
  });
});
