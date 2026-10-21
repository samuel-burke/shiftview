import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "./supabase-browser";
import type { SupabaseClientOptions } from "@supabase/supabase-js";

// Exercise the installed SDK, including its cookie storage and PKCE checks.
vi.unmock("@/lib/supabase-browser");
vi.mock("@supabase/ssr", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...sdk,
    // External SDK modules cache their singleton across vi.resetModules().
    // Give each test a fresh real client so initialization runs for its URL.
    createBrowserClient: (url: string, key: string, options: SupabaseClientOptions<"public">) =>
      sdk.createBrowserClient(url, key, { ...options, isSingleton: false }),
  };
});

const storageKey = "sb-callback-test-auth-token";
const session = {
  access_token: "existing-access-token",
  refresh_token: "existing-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "existing-user", email: "existing@example.test" },
};

function setCookie(key: string, value: unknown) {
  document.cookie = `${key}=base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}; path=/`;
}

let client: ReturnType<typeof createClient> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://callback-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
  fetchMock = vi.fn().mockRejectedValue(new Error("Unexpected auth request"));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/auth/callback");
});

afterEach(async () => {
  await client?.auth.stopAutoRefresh();
  client = undefined;
  for (const cookie of document.cookie.split(";")) {
    document.cookie = `${cookie.split("=")[0].trim()}=; path=/; max-age=0`;
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Supabase browser callback controls", () => {
  it("preserves an existing cookie session when fragment credentials arrive", async () => {
    setCookie(storageKey, session);
    const originalCookies = document.cookie;
    window.history.replaceState(null, "", "/auth/callback#access_token=attacker-access&refresh_token=attacker-refresh&type=invite");
    const { createClient } = await import("./supabase-browser");
    client = createClient();

    const { data, error } = await client.auth.getSession();

    expect(error).toBeNull();
    expect(data.session?.user.id).toBe("existing-user");
    expect(document.cookie).toBe(originalCookies);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a code without the browser's stored PKCE verifier, preserving its session", async () => {
    setCookie(storageKey, session);
    const originalCookies = document.cookie;
    window.history.replaceState(null, "", "/auth/callback?code=unsolicited-code");
    const { createClient } = await import("./supabase-browser");
    client = createClient();

    const { error } = await client.auth.exchangeCodeForSession("unsolicited-code");

    expect(error?.name).toBe("AuthPKCECodeVerifierMissingError");
    expect((await client.auth.getSession()).data.session?.user.id).toBe("existing-user");
    expect(document.cookie).toBe(originalCookies);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves code exchange to the callback and sends the stored verifier to Supabase", async () => {
    setCookie(`${storageKey}-code-verifier`, "browser-verifier");
    window.history.replaceState(null, "", "/auth/callback?code=browser-code");
    fetchMock.mockResolvedValue(new Response(JSON.stringify(session), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const { createClient } = await import("./supabase-browser");
    client = createClient();

    // Creating the shared client must not consume the one-use code first.
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const { data, error } = await client.auth.exchangeCodeForSession("browser-code");

    expect(error).toBeNull();
    expect(data.session?.user.id).toBe("existing-user");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://callback-test.supabase.co/auth/v1/token?grant_type=pkce");
    expect(JSON.parse(options.body)).toEqual({ auth_code: "browser-code", code_verifier: "browser-verifier" });
    expect(document.cookie).not.toContain("code-verifier");
    expect((await client.auth.getSession()).data.session?.user.id).toBe("existing-user");
  });
});
