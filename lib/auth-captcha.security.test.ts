import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Exercise the installed SDK's wire format, rather than mocking its auth
// methods: Supabase's CAPTCHA middleware reads gotrue_meta_security.
describe("Supabase Auth CAPTCHA transport", () => {
  it.each(["signup", "login", "demo"])("forwards the %s challenge in the provider request", async (flow) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "captcha_failed", msg: "Synthetic CAPTCHA rejection",
    }), { status: 400, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } }));
    const supabase = createClient("https://auth.example.test", "synthetic-anon-key", {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `captcha-test-${flow}` },
    });
    const { error } = flow === "demo"
      ? await supabase.auth.signInAnonymously({ options: { captchaToken: "fresh-token" } })
      : await supabase.auth.signInWithOtp({
        email: "person@example.test",
        options: { shouldCreateUser: flow === "signup", captchaToken: "fresh-token" },
      });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://auth.example.test/auth/v1/${flow === "demo" ? "signup" : "otp"}`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.gotrue_meta_security).toEqual({ captcha_token: "fresh-token" });
    if (flow !== "demo") expect(body.create_user).toBe(flow === "signup");
    expect(error?.code).toBe("captcha_failed");
  });
});
