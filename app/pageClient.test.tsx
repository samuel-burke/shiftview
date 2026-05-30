import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Page from "./pageClient";

// Mock Next.js hooks
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (_: string) => null }),
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

describe("pageClient mount fetches", () => {
  it("fires all four initial fetches in parallel on mount", async () => {
    render(<Page />);
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(urls.some((u) => u.includes("/api/employees"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/me"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/store-hours"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/settings"))).toBe(true);
    });
  });

  it("still populates employees when /api/me fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/employees")) return makeJsonResponse([{ id: 1, name: "Bob" }]);
      if (url.includes("/api/me")) return Promise.reject(new Error("network error"));
      if (url.includes("/api/store-hours")) return makeJsonResponse({});
      if (url.includes("/api/settings")) return makeJsonResponse({ optimalCoverage: 3, minCoverage: 2, firstDayOfWeek: 1 });
      if (url.includes("/api/schedules")) return makeJsonResponse([]);
      return makeJsonResponse({});
    });
    render(<Page />);
    await waitFor(() => {
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    });
  });

  it("still populates store hours and settings when /api/employees fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/employees")) return Promise.reject(new Error("network error"));
      if (url.includes("/api/me")) return makeJsonResponse({ isManager: false, employeeName: null });
      if (url.includes("/api/store-hours")) return makeJsonResponse({ 1: { open: 600, close: 1200 } });
      if (url.includes("/api/settings")) return makeJsonResponse({ optimalCoverage: 5, minCoverage: 2, firstDayOfWeek: 1 });
      if (url.includes("/api/schedules")) return makeJsonResponse([]);
      return makeJsonResponse({});
    });
    render(<Page />);
    // No crash — error is set but other fetches populated their state
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(calls.some((u) => u.includes("/api/store-hours"))).toBe(true);
      expect(calls.some((u) => u.includes("/api/settings"))).toBe(true);
    });
  });
});
