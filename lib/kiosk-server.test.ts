import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  clearKioskCookieHeader,
  hashKioskToken,
  isKioskTokenShape,
  kioskCookieHeader,
  kioskTokenFromRequest,
  newKioskToken,
  KIOSK_COOKIE,
} from "./kiosk-server";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

describe("kiosk tokens", () => {
  it("are 256 random bits as 43 base64url characters, never repeated", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newKioskToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("are stored only as their SHA-256 (64 hex), which isn't the token", () => {
    const t = newKioskToken();
    const h = hashKioskToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash("sha256").update(t).digest("hex"));
    expect(h).not.toContain(t);
    expect(hashKioskToken(t)).toBe(h);
    expect(hashKioskToken(newKioskToken())).not.toBe(h);
  });

  it.each(["", "short", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "/", null, 5])(
    "a token of the wrong shape (%j) is refused",
    (t) => {
      expect(isKioskTokenShape(t)).toBe(false);
    },
  );
});

describe("the kiosk cookie", () => {
  it("is HttpOnly, SameSite=Strict, scoped to the kiosk API and long-lived", () => {
    const h = kioskCookieHeader("tok", new Request("https://app.test/api/kiosk/devices"));
    const parts = h.split("; ");
    expect(parts[0]).toBe(`${KIOSK_COOKIE}=tok`);
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("SameSite=Strict");
    expect(parts).toContain("Path=/api/kiosk");
    expect(parts).toContain("Secure");
    expect(parts).toContain(`Max-Age=${400 * 86400}`);
  });

  it("is Secure in production even when the request URL says http (behind a proxy)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(kioskCookieHeader("tok", new Request("http://app.test/api/kiosk/devices"))).toContain("Secure");
  });

  it("isn't Secure on plain-http local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(kioskCookieHeader("tok", new Request("http://localhost:3000/api/kiosk/devices"))).not.toContain("Secure");
  });

  it("clearing it expires it on the same path", () => {
    const h = clearKioskCookieHeader(new Request("https://app.test/api/kiosk/status"));
    expect(h).toContain(`${KIOSK_COOKIE}=;`);
    expect(h).toContain("Max-Age=0");
    expect(h).toContain("Path=/api/kiosk");
  });

  it("is read from the request's cookies, and only in the shape we issue", () => {
    const t = newKioskToken();
    const req = (cookie?: string) =>
      new Request("https://app.test/api/kiosk/identify", { headers: cookie ? { cookie } : {} });
    expect(kioskTokenFromRequest(req(`sb-x=1; ${KIOSK_COOKIE}=${t}; sv_org=abc`))).toBe(t);
    expect(kioskTokenFromRequest(req())).toBeNull();
    expect(kioskTokenFromRequest(req(`${KIOSK_COOKIE}=not-a-token`))).toBeNull();
    expect(kioskTokenFromRequest(req(`other=${t}`))).toBeNull();
  });
});
