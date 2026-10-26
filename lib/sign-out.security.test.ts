import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOut } from "./sign-out";
import { reconcilePushSubscription } from "./push-subscription";

const endpoint = "https://push.example/current-browser";
const browserSubscription = { endpoint, unsubscribe: vi.fn() };
const getSubscription = vi.fn();
const getRegistration = vi.fn();
const authSignOut = vi.fn();
const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
const from = vi.fn();
const supabase = { auth: { signOut: authSignOut }, from } as unknown as SupabaseClient;
const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration },
  });
  getRegistration.mockResolvedValue({ pushManager: { getSubscription } });
  getSubscription.mockResolvedValue(browserSubscription);
  browserSubscription.unsubscribe.mockResolvedValue(true);
  authSignOut.mockResolvedValue({ error: null });
  from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { endpoint }, error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (serviceWorkerDescriptor) Object.defineProperty(navigator, "serviceWorker", serviceWorkerDescriptor);
  else Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("logout push revocation", () => {
  it("removes only this endpoint and deactivates it before removing authentication", async () => {
    const order: string[] = [];
    vi.mocked(fetch).mockImplementation(async () => {
      order.push("server revocation");
      expect(authSignOut).not.toHaveBeenCalled();
      return new Response(null, { status: 200 });
    });
    browserSubscription.unsubscribe.mockImplementationOnce(async () => {
      order.push("browser revocation");
      expect(authSignOut).not.toHaveBeenCalled();
      return true;
    });
    authSignOut.mockImplementationOnce(async () => {
      order.push("sign out");
      return { error: null };
    });

    expect(await signOut(supabase)).toBe(true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(order).toEqual(["server revocation", "browser revocation", "sign out"]);
  });

  it.each(["network error", "server error"])("still revokes browser delivery on %s", async (failure) => {
    if (failure === "network error") vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    else vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

    expect(await signOut(supabase)).toBe(true);
    expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(authSignOut).toHaveBeenCalledOnce();
  });

  it("keeps authentication and reports failure if browser revocation rejects", async () => {
    browserSubscription.unsubscribe.mockRejectedValueOnce(new Error("unsubscribe failed"));

    expect(await signOut(supabase)).toBe(false);
    expect(authSignOut).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("try again"));
  });

  it("accepts false from unsubscribe because the endpoint is already inactive", async () => {
    browserSubscription.unsubscribe.mockResolvedValueOnce(false);
    expect(await signOut(supabase)).toBe(true);
    expect(authSignOut).toHaveBeenCalledOnce();
  });

  it.each(["unsupported browser", "no registration", "no subscription"])("allows logout with %s", async (state) => {
    if (state === "unsupported browser") Reflect.deleteProperty(navigator, "serviceWorker");
    if (state === "no registration") getRegistration.mockResolvedValue(undefined);
    if (state === "no subscription") getSubscription.mockResolvedValue(null);

    expect(await signOut(supabase)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(authSignOut).toHaveBeenCalledOnce();
  });

  it("does not report successful logout when Supabase rejects sign out", async () => {
    authSignOut.mockResolvedValueOnce({ error: new Error("auth unavailable") });
    expect(await signOut(supabase)).toBe(false);
    expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(window.alert).toHaveBeenCalledOnce();
  });
});

describe("push ownership after an account change", () => {
  it("preserves a subscription belonging to the signed-in account", async () => {
    expect(await reconcilePushSubscription(supabase, "current-user")).toBe(browserSubscription);
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(query.eq).toHaveBeenCalledWith("user_id", "current-user");
    expect(query.eq).toHaveBeenCalledWith("endpoint", endpoint);
    expect(browserSubscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("deactivates a prior account's endpoint instead of registering it to the new user", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await reconcilePushSubscription(supabase, "different-user")).toBeNull();
    expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deactivates legacy subscriptions when the page opens signed out", async () => {
    expect(await reconcilePushSubscription(supabase, null)).toBeNull();
    expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("deactivates the endpoint if ownership cannot be verified", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("database unavailable") });
    await expect(reconcilePushSubscription(supabase, "different-user")).rejects.toThrow("database unavailable");
    expect(browserSubscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
