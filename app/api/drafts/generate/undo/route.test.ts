import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
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

function postReq(body: unknown) {
  return new Request("http://localhost/api/drafts/generate/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function client(rpcData: any, rpcError: any = null, isManager = true) {
  const c = makeSupabaseClient({ user: MOCK_USER, isManager, rpcData, rpcError });
  mockCreateClient.mockResolvedValue(c as any);
  return c;
}

describe("POST /api/drafts/generate/undo", () => {
  it("returns 400 without an integer runId", async () => {
    client(null);
    expect((await POST(postReq({ runId: "7" }))).status).toBe(400);
  });

  it("returns 401 when not signed in", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    expect((await POST(postReq({ runId: 7 }))).status).toBe(401);
  });

  it("returns 403 for non-managers", async () => {
    client(null, null, false);
    expect((await POST(postReq({ runId: 7 }))).status).toBe(403);
  });

  it("undoes the run in the caller's org", async () => {
    const c = client({ status: "ok", week_start: "2026-10-12", removed: 12, restored: 3 });
    const res = await POST(postReq({ runId: 7 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 12, restored: 3 });
    expect(c.rpc).toHaveBeenCalledWith("undo_generation_run", { p_org: MOCK_ORG_ID, p_run_id: 7 });
  });

  it.each([
    ["not_found", 404],
    ["already_undone", 409],
    ["published", 409],
    ["not_latest", 409],
    ["forbidden", 403],
  ])("maps %s to %i", async (status, code) => {
    client({ status });
    expect((await POST(postReq({ runId: 7 }))).status).toBe(code);
  });

  it("returns 503 when the migration hasn't been applied", async () => {
    client(null, { code: "PGRST202", message: "function not found" });
    expect((await POST(postReq({ runId: 7 }))).status).toBe(503);
  });

  it("returns 500 on other errors", async () => {
    client(null, { code: "XX000", message: "boom" });
    expect((await POST(postReq({ runId: 7 }))).status).toBe(500);
  });
});
