import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { verifyTurnstileToken } from "@/lib/turnstile";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/turnstile", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/turnstile")>(),
  verifyTurnstileToken: vi.fn(),
}));
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
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { signInWithOtp } } as any);
  vi.mocked(verifyTurnstileToken).mockClear();
});

const req = (origin?: string) =>
  new Request("https://shiftview.example/api/auth/signup-otp", {
    method: "POST",
    headers: origin ? { origin } : {},
    body: JSON.stringify({ email: "new@example.com", turnstileToken: "t" }),
  });

describe("POST /api/auth/signup-otp", () => {
  it("returns a provider CAPTCHA rejection", async () => {
    signInWithOtp.mockResolvedValue({ error: { code: "captcha_failed", message: "Verification failed" } });
    const res = await POST(req("https://shiftview.example"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Verification failed" });
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
  });

  it("forwards the single-use token to Auth without consuming it first", async () => {
    const res = await POST(req("https://shiftview.example"));
    expect(res.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "new@example.com",
      options: { shouldCreateUser: true, captchaToken: "t", emailRedirectTo: "https://shiftview.example/auth/callback" },
    });
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
  });

  it.each([null, "", "   ", 123, {}])("rejects a missing or malformed token (%j) before calling Auth", async (turnstileToken) => {
    const res = await POST(new Request("https://shiftview.example/api/auth/signup-otp", {
      method: "POST", body: JSON.stringify({ email: "new@example.com", turnstileToken }),
    }));
    expect(res.status).toBe(403);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("fails closed when the production app secret is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect((await POST(req())).status).toBe(403);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("allows an unconfigured local project to request an OTP", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const res = await POST(new Request("http://localhost/api/auth/signup-otp", {
      method: "POST", body: JSON.stringify({ email: "new@example.com" }),
    }));
    expect(res.status).toBe(200);
    expect(signInWithOtp.mock.calls[0][0].options.captchaToken).toBeUndefined();
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
