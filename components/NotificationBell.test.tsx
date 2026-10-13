import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The bell keeps its notifications, session and Realtime channel in a
// module-level store shared by every mounted bell, so each test loads a fresh
// copy of the module.
let NotificationBell: typeof import("./NotificationBell").default;
beforeEach(async () => {
  vi.resetModules();
  NotificationBell = (await import("./NotificationBell")).default;
});

const { channelSpy, getSessionSpy } = vi.hoisted(() => ({ channelSpy: vi.fn(), getSessionSpy: vi.fn() }));
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => {
        getSessionSpy(...args);
        return Promise.resolve({ data: { session: { user: { id: "user-123" } } }, error: null });
      },
    },
    channel: (...args: unknown[]) => {
      channelSpy(...args);
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));
beforeEach(() => {
  channelSpy.mockClear();
  getSessionSpy.mockClear();
});

const SAMPLE_NOTIFICATIONS = [
  {
    id: 1,
    type: "shift_change",
    title: "Shift Updated",
    body: "Your shift on May 25 has been changed.",
    read: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    type: "shift_reminder",
    title: "Shift Reminder",
    body: "You have a shift starting soon.",
    read: true,
    created_at: new Date().toISOString(),
  },
];

function setupFetch(notifications = SAMPLE_NOTIFICATIONS) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes("/api/notifications")) {
      return { ok: true, json: async () => notifications } as Response;
    }
    // PATCH (mark all read) and DELETE both succeed
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

async function openPanel() {
  // Wait for the bell button (renders after auth resolves)
  const bell = await screen.findByRole("button", { name: /notifications/i });
  await userEvent.click(bell);
}

// ── Dismiss individual notification ───────────────────────────────────────────

describe("NotificationBell — dismiss individual", () => {
  let fetchSpy: ReturnType<typeof setupFetch>;
  beforeEach(() => { fetchSpy = setupFetch(); });

  it("shows a dismiss button for each notification when the panel is open", async () => {
    render(<NotificationBell />);
    await openPanel();
    await waitFor(() => {
      const dismissBtns = screen.getAllByRole("button", { name: /dismiss/i });
      expect(dismissBtns).toHaveLength(SAMPLE_NOTIFICATIONS.length);
    });
  });

  it("removes the notification from the list immediately when its dismiss button is clicked", async () => {
    render(<NotificationBell />);
    await openPanel();
    // Wait for both notifications to appear
    await screen.findByText("Shift Updated");
    await screen.findByText("Shift Reminder");

    const [firstDismiss] = screen.getAllByRole("button", { name: /dismiss/i });
    await userEvent.click(firstDismiss);

    await waitFor(() => {
      expect(screen.queryByText("Shift Updated")).not.toBeInTheDocument();
    });
    // Second notification is still there
    expect(screen.getByText("Shift Reminder")).toBeInTheDocument();
  });

  it("calls DELETE /api/notifications with the notification id when dismissed", async () => {
    render(<NotificationBell />);
    await openPanel();
    await screen.findByText("Shift Updated");

    const [firstDismiss] = screen.getAllByRole("button", { name: /dismiss/i });
    await userEvent.click(firstDismiss);

    await waitFor(() => {
      const deleteCalls = fetchSpy!.mock.calls.filter(
        ([, init]) => (init?.method ?? "").toUpperCase() === "DELETE"
      );
      expect(deleteCalls).toHaveLength(1);
      const body = JSON.parse(deleteCalls[0][1]!.body as string);
      expect(body).toEqual({ id: SAMPLE_NOTIFICATIONS[0].id });
    });
  });
});

// ── Clear all ─────────────────────────────────────────────────────────────────

describe("NotificationBell — clear all", () => {
  it("shows the Clear all button when there are notifications", async () => {
    setupFetch();
    render(<NotificationBell />);
    await openPanel();
    await screen.findByText("Shift Updated");
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
  });

  it("does not show the Clear all button when the list is empty", async () => {
    setupFetch([]);
    render(<NotificationBell />);
    await openPanel();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    });
  });

  it("removes all notifications from the list immediately when Clear all is clicked", async () => {
    setupFetch();
    render(<NotificationBell />);
    await openPanel();
    await screen.findByText("Shift Updated");

    await userEvent.click(screen.getByRole("button", { name: /clear all/i }));

    await waitFor(() => {
      expect(screen.queryByText("Shift Updated")).not.toBeInTheDocument();
      expect(screen.queryByText("Shift Reminder")).not.toBeInTheDocument();
    });
  });

  it("calls DELETE /api/notifications with all=true when Clear all is clicked", async () => {
    const fetchSpy = setupFetch();
    render(<NotificationBell />);
    await openPanel();
    await screen.findByText("Shift Updated");

    await userEvent.click(screen.getByRole("button", { name: /clear all/i }));

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init?.method ?? "").toUpperCase() === "DELETE"
      );
      expect(deleteCalls).toHaveLength(1);
      const body = JSON.parse(deleteCalls[0][1]!.body as string);
      expect(body).toEqual({ all: true });
    });
  });
});

// ── Shared between bells ──────────────────────────────────────────────────────

describe("NotificationBell — every bell shares one store", () => {
  it("reads the session, loads notifications and subscribes once for two mounted bells", async () => {
    const fetchSpy = setupFetch();
    render(<><NotificationBell /><NotificationBell /></>);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Notifications, 1 unread" })).toHaveLength(2);
    });
    const loads = fetchSpy.mock.calls.filter(([url, init]) => String(url).includes("/api/notifications") && !init?.method);
    expect(loads).toHaveLength(1);
    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    expect(channelSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps its notifications across a remount (a page navigation) without reloading", async () => {
    const fetchSpy = setupFetch();
    const { unmount } = render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    unmount();
    render(<NotificationBell />);
    // Shown at once from the shared store, not after another request.
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    const loads = fetchSpy.mock.calls.filter(([url, init]) => String(url).includes("/api/notifications") && !init?.method);
    expect(loads).toHaveLength(1);
    expect(channelSpy).toHaveBeenCalledTimes(1);
  });
});
