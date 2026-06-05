import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Page from "./pageClient";

// Mock Next.js hooks
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (_: string) => null }),
}));

// Mock AppDataContext — shared data comes from context in real app
vi.mock("../lib/AppDataContext", () => ({
  useAppData: () => ({
    me: { isManager: true, employeeId: null, employeeName: "Alice" },
    storeHours: { 0: { open: 480, close: 1200 }, 1: { open: 540, close: 1260 }, 2: { open: 360, close: 1320 }, 3: { open: 360, close: 1320 }, 4: { open: 360, close: 1320 }, 5: { open: 360, close: 1320 }, 6: { open: 360, close: 1320 } },
    settings: { firstDayOfWeek: 1, optimalCoverage: 3, minCoverage: 2, coverageAlertsEnabled: true, timezone: "America/New_York", emailNotifications: false, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceLat: null, geofenceLng: null, geofenceRadius: 100, geofenceAddress: null },
    sharedLoading: false,
    refreshMe: vi.fn(),
    refreshStoreHours: vi.fn(),
    refreshSettings: vi.fn(),
    employees: [{ id: 1, name: "Alice" }],
    refreshEmployees: vi.fn(),
    scheduleCache: {},
    setScheduleCache: vi.fn(),
    punchCache: {},
    setPunchCache: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn(),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  }),
}));

vi.mock("../hooks/useIsDesktop", () => ({ useIsDesktop: () => false }));

const mockFetch = vi.fn();

function makeJsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/employees")) return makeJsonResponse([{ id: 1, name: "Alice" }]);
    if (url.includes("/api/me")) return makeJsonResponse({ isManager: true, employeeName: "Alice" });
    if (url.includes("/api/store-hours")) return makeJsonResponse({ 1: { open: 540, close: 1260 } });
    if (url.includes("/api/settings")) return makeJsonResponse({ optimalCoverage: 3, minCoverage: 2, firstDayOfWeek: 1 });
    if (url.includes("/api/schedules")) return makeJsonResponse([]);
    return makeJsonResponse({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pageClient attendance", () => {
  it("fetches punch records when manager is viewing today", async () => {
    render(<Page />);
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(urls.some((u) => u.includes("/api/punches"))).toBe(true);
    });
  });

  it("shows Clocked In badge for a scheduled employee when manager sees punch data", async () => {
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/employees")) return makeJsonResponse([{ id: 1, name: "Alice Smith" }]);
      if (url.includes("/api/me")) return makeJsonResponse({ isManager: true, employeeName: "Manager" });
      if (url.includes("/api/store-hours")) return makeJsonResponse({});
      if (url.includes("/api/settings")) return makeJsonResponse({ optimalCoverage: 3, minCoverage: 2, firstDayOfWeek: 1 });
      if (url.includes("/api/schedules")) {
        // Return a shift that is currently in progress (0–1440 covers all day)
        return makeJsonResponse([{ id: 1, employeeId: 1, date: todayKey, startMinutes: 0, endMinutes: 1440 }]);
      }
      if (url.includes("/api/punches")) {
        return makeJsonResponse([{
          id: 1, employeeId: 1, scheduleId: 1,
          punchType: "clock_in", punchedAt: new Date().toISOString(),
          lat: null, lng: null, isManual: false, note: null,
        }]);
      }
      return makeJsonResponse({});
    });
    render(<Page />);
    await waitFor(() => {
      expect(screen.getAllByText("Clocked In").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("pageClient mount fetches", () => {
  it("fetches schedules on mount (employees/me/store-hours/settings come from AppDataContext)", async () => {
    render(<Page />);
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(urls.some((u) => u.includes("/api/schedules"))).toBe(true);
      // employees now come from context, not a direct fetch
      expect(urls.some((u) => u.includes("/api/employees"))).toBe(false);
    });
  });

  it("renders employees from context without fetching /api/employees", async () => {
    // The mock context provides [{ id: 1, name: "Alice" }] as employees
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/schedules")) return makeJsonResponse([]);
      return makeJsonResponse({});
    });
    render(<Page />);
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    });
  });

  it("does not crash and renders schedules even when no punches are returned", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/schedules")) return makeJsonResponse([]);
      if (url.includes("/api/punches")) return Promise.reject(new Error("network error"));
      return makeJsonResponse({});
    });
    render(<Page />);
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(calls.some((u) => u.includes("/api/schedules"))).toBe(true);
    });
  });
});
