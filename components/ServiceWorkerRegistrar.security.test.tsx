import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ServiceWorkerRegistrar from "./ServiceWorkerRegistrar";
import { reconcilePushSubscription } from "@/lib/push-subscription";

let onAuthChange: (event: AuthChangeEvent, session: Session | null) => void;
const unsubscribe = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: typeof onAuthChange) => {
        onAuthChange = callback;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  }),
}));
vi.mock("@/lib/push-subscription", () => ({ reconcilePushSubscription: vi.fn() }));
const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(reconcilePushSubscription).mockResolvedValue(null);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue({}) },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (serviceWorkerDescriptor) Object.defineProperty(navigator, "serviceWorker", serviceWorkerDescriptor);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

it.each(["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"] as const)(
  "reconciles push ownership on %s after releasing the auth callback",
  async (event) => {
    render(<ServiceWorkerRegistrar />);
    const session = event === "SIGNED_OUT" ? null : { user: { id: "new-user" } } as Session;
    act(() => onAuthChange(event, session));
    expect(reconcilePushSubscription).not.toHaveBeenCalled();
    await act(() => vi.runAllTimersAsync());
    expect(reconcilePushSubscription).toHaveBeenCalledWith(expect.anything(), session?.user.id ?? null);
  }
);

it("cancels pending reconciliation when unmounted", async () => {
  const { unmount } = render(<ServiceWorkerRegistrar />);
  act(() => onAuthChange("SIGNED_OUT", null));
  unmount();
  await vi.runAllTimersAsync();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(reconcilePushSubscription).not.toHaveBeenCalled();
});
