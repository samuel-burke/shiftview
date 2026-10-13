import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AppDataProvider, useAppData, ME_CACHE_KEY } from "./AppDataContext";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;
let authCallbacks: AuthCallback[] = [];
const channelOn = vi.fn();
const channelNames: string[] = [];

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => { authCallbacks = authCallbacks.filter((c) => c !== cb); } } } };
      },
      getUser: () => Promise.resolve({ data: { user: null } }),
    },
    channel: (name: string) => {
      channelNames.push(name);
      const channel = {
        on: (...args: unknown[]) => { channelOn(...args); return channel; },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

const ME = { isManager: true, employeeId: 7, employeeName: "Sam Kim", isDemo: false, orgId: "org-1", organizations: [] };

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn((url: string) => {
  if (url === "/api/me") return json(ME);
  if (url === "/api/store-hours") return json({ 1: { open: 420, close: 1200 } });
  if (url === "/api/settings") return json({ firstDayOfWeek: 0, timezone: "America/Chicago" });
  if (url === "/api/punches/current") return json({ punches: [{ id: 1, employeeId: 7, punchType: "clock_in", punchedAt: new Date().toISOString() }] });
  return json({});
});

const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;

function Probe() {
  const { me, settings, liveStatus } = useAppData();
  return <div data-testid="probe">{`${me.employeeName ?? "-"}|${settings.timezone}|${settings.firstDayOfWeek}|${liveStatus}`}</div>;
}

function renderProvider() {
  return render(<AppDataProvider><Probe /></AppDataProvider>);
}

beforeEach(() => {
  pathname = "/";
  authCallbacks = [];
  channelNames.length = 0;
  channelOn.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("AppDataProvider startup", () => {
  it("loads identity, settings, store hours and the attendance status together, once each", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Sam Kim|America/Chicago|0|clocked_in"));
    expect(calls("/api/me")).toBe(1);
    expect(calls("/api/store-hours")).toBe(1);
    expect(calls("/api/settings")).toBe(1);
    expect(calls("/api/punches/current")).toBe(1);
  });

  it("renders a return visit from the cache, settings included, without fetching the status twice", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(ME));
    localStorage.setItem("sv_org_config", JSON.stringify({ orgId: "org-1", settings: { firstDayOfWeek: 3, timezone: "Pacific/Honolulu" }, storeHours: {} }));
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string) => (url === "/api/me" ? new Promise(() => {}) : answer(url))); // /api/me never answers
    renderProvider();
    // Cached identity and that org's settings show before any response.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^Sam Kim\|Pacific\/Honolulu\|3\|/));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/\|clocked_in$/));
    expect(calls("/api/punches/current")).toBe(1);
    fetchMock.mockImplementation(answer);
  });

  it("ignores cached settings that belong to another organization", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(ME));
    localStorage.setItem("sv_org_config", JSON.stringify({ orgId: "org-2", settings: { firstDayOfWeek: 3, timezone: "Pacific/Honolulu" }, storeHours: {} }));
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^Sam Kim\|/));
    expect(screen.getByTestId("probe").textContent).not.toContain("Pacific/Honolulu");
    fetchMock.mockImplementation(answer);
  });

  it("loads nothing on signed-out pages", async () => {
    pathname = "/login";
    renderProvider();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(channelNames).toEqual([]);
  });
});

describe("AppDataProvider auth events", () => {
  async function started() {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("Sam Kim"));
    fetchMock.mockClear();
  }

  it("does not reload when Supabase re-validates the same session (startup, tab refocus, token refresh)", async () => {
    await started();
    act(() => authCallbacks.forEach((cb) => cb("INITIAL_SESSION", { user: { id: "u1" } })));
    act(() => authCallbacks.forEach((cb) => cb("SIGNED_IN", { user: { id: "u1" } })));
    act(() => authCallbacks.forEach((cb) => cb("TOKEN_REFRESHED", { user: { id: "u1" } })));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads when a different user signs in", async () => {
    await started();
    act(() => authCallbacks.forEach((cb) => cb("INITIAL_SESSION", null)));
    act(() => authCallbacks.forEach((cb) => cb("SIGNED_IN", { user: { id: "u2" } })));
    await waitFor(() => expect(calls("/api/me")).toBe(1));
    expect(calls("/api/settings")).toBe(1);
    expect(calls("/api/store-hours")).toBe(1);
  });
});

describe("AppDataProvider realtime", () => {
  it("subscribes to its own organization's changes and only this employee's punches", async () => {
    renderProvider();
    await waitFor(() => expect(channelOn).toHaveBeenCalledTimes(3));
    const filters = channelOn.mock.calls.map(([, opts]) => (opts as { table: string; filter: string }));
    expect(filters).toEqual([
      expect.objectContaining({ table: "store_hours", filter: "org_id=eq.org-1" }),
      expect.objectContaining({ table: "app_settings", filter: "org_id=eq.org-1" }),
      expect.objectContaining({ table: "punch_records", filter: "employee_id=eq.7" }),
    ]);
  });
});
