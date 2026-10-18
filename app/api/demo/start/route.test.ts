import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendNtfy } from "@/lib/ntfy";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: vi.fn() }));
vi.mock("@/lib/demo-seed", () => ({ seedDemoOrg: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/ntfy", () => ({ sendNtfy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockVerify = vi.mocked(verifyTurnstileToken);

function builder(result: { data?: any; error?: any; count?: number }) {
  const b: any = {};
  for (const m of ["select", "eq", "update", "upsert", "insert"]) b[m] = vi.fn().mockReturnValue(b);
  b.maybeSingle = vi.fn().mockResolvedValue({ data: result.data ?? null, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? 1 }).then(resolve, reject);
  return b;
}

function setup({ session = null as any, demoMember = false } = {}) {
  const signInAnonymously = vi.fn().mockResolvedValue({ data: { user: { id: "anon-new" } }, error: null });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: session } }), signInAnonymously },
  } as any);
  const managers = builder({ data: demoMember ? { user_id: session?.id } : null });
  const admin = {
    from: vi.fn((table: string) => (table === "managers" ? managers : builder({}))),
  };
  vi.mocked(createAdminClient).mockReturnValue(admin as any);
  return { signInAnonymously, managers };
}

const req = (body: object = {}) =>
  new Request("http://localhost/api/demo/start", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  mockVerify.mockReset();
  vi.mocked(sendNtfy).mockClear();
});

describe("POST /api/demo/start — bot gate", () => {
  it("rejects a new visitor who fails verification without creating a user", async () => {
    mockVerify.mockResolvedValue(false);
    const { signInAnonymously, managers } = setup();
    const res = await POST(req({ turnstileToken: "bad" }));
    expect(res.status).toBe(403);
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(managers.upsert).not.toHaveBeenCalled();
  });

  it("gates an anonymous session minted outside this route", async () => {
    // Supabase Auth hands out anonymous sessions to anyone with the anon key;
    // that must not be a way around the challenge.
    mockVerify.mockResolvedValue(false);
    const { managers } = setup({ session: { id: "anon-direct", is_anonymous: true } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockVerify).toHaveBeenCalled();
    expect(managers.upsert).not.toHaveBeenCalled();
  });

  it("lets an existing demo member re-provision without a new challenge", async () => {
    const { signInAnonymously } = setup({ session: { id: "anon-member", is_anonymous: true }, demoMember: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(sendNtfy).not.toHaveBeenCalled();
  });

  it("starts a session for a verified new visitor", async () => {
    mockVerify.mockResolvedValue(true);
    const { signInAnonymously, managers } = setup();
    const res = await POST(req({ turnstileToken: "good" }));
    expect(res.status).toBe(200);
    expect(signInAnonymously).toHaveBeenCalled();
    expect(managers.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "anon-new" }),
      expect.anything()
    );
    expect(sendNtfy).toHaveBeenCalledWith(expect.objectContaining({ title: "Demo started on ShiftView" }));
  });

  it("includes the visitor's coarse location in the alert", async () => {
    mockVerify.mockResolvedValue(true);
    setup();
    const request = new Request("http://localhost/api/demo/start", {
      method: "POST",
      body: "{}",
      headers: { "x-vercel-ip-city": "San%20Francisco", "x-vercel-ip-country": "US" },
    });
    await POST(request);
    expect(vi.mocked(sendNtfy).mock.calls[0][0].message).toContain("San Francisco, US");
  });

  it("refuses a signed-in real account", async () => {
    setup({ session: { id: "real", is_anonymous: false } });
    const res = await POST(req());
    expect(res.status).toBe(409);
  });
});
