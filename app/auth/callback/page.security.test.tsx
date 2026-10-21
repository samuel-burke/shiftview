import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import AuthCallback from "./page";

const { router, createClient, exchangeCodeForSession, setSession } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase-browser", () => ({ createClient }));

beforeEach(() => {
  vi.resetAllMocks();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  createClient.mockReturnValue({ auth: { exchangeCodeForSession, setSession } });
  window.history.replaceState(null, "", "/auth/callback");
});

describe("auth callback security", () => {
  it.each([
    "#access_token=attacker-access&refresh_token=attacker-refresh",
    "#access_token=attacker-access&refresh_token=attacker-refresh&type=invite",
    "#access_token=attacker-access",
    "?code=",
    "",
  ])("requires email-code login for an unbound callback (%s)", async (suffix) => {
    window.history.replaceState(null, "", `/auth/callback${suffix}`);
    render(<AuthCallback />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    // No auth operation may adopt an account or replace an existing session.
    expect(createClient).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE code once, ignoring any fragment credentials", async () => {
    window.history.replaceState(null, "", "/auth/callback?code=browser-code#access_token=attacker-access&refresh_token=attacker-refresh");
    let completeExchange!: (value: { error: null }) => void;
    exchangeCodeForSession.mockReturnValue(new Promise((resolve) => { completeExchange = resolve; }));

    render(<StrictMode><AuthCallback /></StrictMode>);

    await waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledWith("browser-code"));
    expect(router.replace).not.toHaveBeenCalled();
    completeExchange({ error: null });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(setSession).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["returned", "thrown"])("sends a %s exchange failure to login without using fragment credentials", async (failure) => {
    window.history.replaceState(null, "", "/auth/callback?code=invalid-code#access_token=attacker-access&refresh_token=attacker-refresh");
    if (failure === "returned") {
      exchangeCodeForSession.mockResolvedValue({ error: new Error("Invalid PKCE verifier") });
    } else {
      exchangeCodeForSession.mockRejectedValue(new Error("Network failure"));
    }

    render(<AuthCallback />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(router.replace).not.toHaveBeenCalledWith("/");
    expect(setSession).not.toHaveBeenCalled();
  });
});
