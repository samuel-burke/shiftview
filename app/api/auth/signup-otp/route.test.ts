import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { verifyTurnstileToken } from "@/lib/turnstile";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const signInWithOtp = vi.fn();

beforeEach(() => {
  vi.unstubAllEnvs();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { signInWithOtp } } as any);
  vi.mocked(verifyTurnstileToken).mockReset().mockResolvedValue(true);
});

const req = (origin?: string) =>
  new Request("https://shiftview.example/api/auth/signup-otp", {
    method: "POST",
    headers: origin ? { origin } : {},
    body: JSON.stringify({ email: "new@example.com", turnstileToken: "t" }),
  });

describe("POST /api/auth/signup-otp", () => {
  it("rejects a failed verification without sending an email", async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValue(false);
    const res = await POST(req("https://shiftview.example"));
    expect(res.status).toBe(403);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("links the email back to this site", async () => {
    await POST(req("https://shiftview.example"));
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://shiftview.example/auth/callback"
    );
  });

  it("ignores an Origin header naming another host", async () => {
    await POST(req("https://attacker.example"));
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBeUndefined();
  });

  it("accepts the configured site URL as an origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.shiftview.example/");
    await POST(req("https://www.shiftview.example"));
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://www.shiftview.example/auth/callback"
    );
  });
});
