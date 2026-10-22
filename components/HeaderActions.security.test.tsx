import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HeaderActions from "./HeaderActions";

const { authSignOut } = vi.hoisted(() => ({ authSignOut: vi.fn() }));
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({ auth: { signOut: authSignOut } }),
}));
vi.mock("@/lib/AppDataContext", () => ({
  useAppData: () => ({ me: { employeeName: "Alice", organizations: [] } }),
}));
vi.mock("./NotificationBell", () => ({ default: () => null }));
const descriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (descriptor) Object.defineProperty(navigator, "serviceWorker", descriptor);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

it("keeps the header signed in when push revocation fails", async () => {
  const location = window.location.href;
  const unsubscribe = vi.fn().mockRejectedValue(new Error("browser revocation failed"));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ endpoint: "https://push.example/browser", unsubscribe }),
        },
      }),
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  render(<HeaderActions />);
  fireEvent.click(screen.getByRole("button", { name: "User menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign Out" }));

  await waitFor(() => expect(alert).toHaveBeenCalledOnce());
  expect(authSignOut).not.toHaveBeenCalled();
  expect(window.location.href).toBe(location);
});
