import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.unstubAllEnvs();
});

describe("verifyTurnstileToken", () => {
  it("passes when TURNSTILE_SECRET_KEY is not configured (feature off)", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyTurnstileToken(null)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails when configured but no token is provided", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(await verifyTurnstileToken(null)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes when siteverify reports success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstileToken("token-abc", "1.2.3.4")).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("challenges.cloudflare.com");
    const body = init.body as URLSearchParams;
    expect(body.get("response")).toBe("token-abc");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("fails when siteverify reports failure", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 })
    );
    expect(await verifyTurnstileToken("bad-token")).toBe(false);
  });

  it("fails closed when the siteverify request errors", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await verifyTurnstileToken("token-abc")).toBe(false);
  });
});
