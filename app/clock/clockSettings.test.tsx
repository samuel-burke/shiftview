// The clock under org settings other than the defaults: the geofence, break
// types, break attestation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ClockPageClient from "./clockPageClient";
import { DEFAULT_SETTINGS, DEFAULT_STORE_HOURS, type AppSettings } from "@/lib/AppDataContext";

let settings: AppSettings = DEFAULT_SETTINGS;

vi.mock("@/lib/AppDataContext", async (orig) => {
  const actual = await orig<typeof import("@/lib/AppDataContext")>();
  return {
    ...actual,
    useAppData: () => ({
      me: { isManager: false, employeeId: 5, employeeName: "Alex Kim", isDemo: false, orgId: null, organizations: [] },
      storeHours: actual.DEFAULT_STORE_HOURS,
      settings,
      scheduleCache: {},
      setScheduleCache: () => {},
      punchCache: {},
      setPunchCache: () => {},
      setLiveStatus: () => {},
    }),
  };
});
vi.mock("@/lib/supabase-browser", () => {
  const channel: any = { on: () => channel, subscribe: () => channel };
  return {
    createClient: () => ({
      auth: {
        signOut: vi.fn(),
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      channel: () => channel,
      removeChannel: vi.fn(),
    }),
  };
});
vi.mock("@/lib/sounds", () => ({ playPunchSound: vi.fn() }));
vi.mock("@/lib/haptic", () => ({ haptic: vi.fn() }));
vi.mock("framer-motion", async (orig) => {
  const actual = await orig<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => true };
});

void DEFAULT_STORE_HOURS;

function mockApi({
  todayPunches = [] as Record<string, unknown>[],
  breakTypes = [] as Record<string, unknown>[],
  postResponse = undefined as undefined | ((body: Record<string, unknown>) => { status: number; data: unknown }),
} = {}) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ isManager: false, employeeId: 5, employeeName: "Alex Kim" });
    if (url.startsWith("/api/schedules")) return json([]);
    if (url.startsWith("/api/punches/missed")) return json({ missedPunch: null });
    if (url.startsWith("/api/punches") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (postResponse) {
        const r = postResponse(body);
        return json(r.data, r.status);
      }
      return json({ id: 50 + posts.length, employeeId: 5, scheduleId: null, punchType: body.punchType,
        punchedAt: new Date().toISOString(), lat: body.lat ?? null, lng: body.lng ?? null, isManual: false, note: null }, 201);
    }
    if (url.startsWith("/api/punches/current")) return json({ carriedOver: false, punches: todayPunches });
    if (url.startsWith("/api/punches")) return json(todayPunches);
    if (url.startsWith("/api/break-types")) return json({ breakTypes });
    if (url.startsWith("/api/punch-corrections")) return json({ corrections: [] });
    if (url.startsWith("/api/callouts")) return json({ callouts: [] });
    if (url.startsWith("/api/timecard")) return json({ days: [], weeks: [] });
    return json({});
  }));
  return { posts };
}

function mockLocation(coords: { latitude: number; longitude: number } | null) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: () => void) =>
        coords ? ok({ coords }) : fail(),
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
  settings = { ...DEFAULT_SETTINGS, timezone: "America/New_York" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Clock — a geofence with GPS not required", () => {
  beforeEach(() => {
    settings = { ...settings, gpsRequired: false, geofenceEnabled: true, geofenceLat: 40.7128, geofenceLng: -74.006, geofenceRadius: 100 };
  });

  it("asks for the location and sends it with the clock-in", async () => {
    mockLocation({ latitude: 40.7129, longitude: -74.0061 });
    const { posts } = mockApi();
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "clock_in", lat: 40.7129, lng: -74.0061 })]));
  });

  it("says location is needed, and sends nothing, when the phone won't share it", async () => {
    mockLocation(null);
    const { posts } = mockApi();
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/Location is needed to clock in at this store/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("refuses a clock-in outside the fence before sending it", async () => {
    mockLocation({ latitude: 40.73, longitude: -74.006 });
    const { posts } = mockApi();
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/You must be within 100m/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("doesn't ask for the location when the geofence is off", async () => {
    settings = { ...settings, geofenceEnabled: false };
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    const { posts } = mockApi();
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(posts[0]).toMatchObject({ lat: null, lng: null });
  });
});
