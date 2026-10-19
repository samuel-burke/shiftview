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

const clockedIn = [{ id: 1, employeeId: 5, scheduleId: null, punchType: "clock_in", punchedAt: "2026-11-01T13:00:00.000Z", lat: null, lng: null, isManual: false, note: null }];
const twoTypes = [
  { id: 7, name: "Rest", paid: true, minMinutes: 10, sortOrder: 0, archived: false },
  { id: 8, name: "Meal", paid: false, minMinutes: 30, sortOrder: 1, archived: false },
];

describe("Clock — break types", () => {
  it("asks which break when the store has more than one, and sends the one picked", async () => {
    const { posts } = mockApi({ todayPunches: clockedIn, breakTypes: twoTypes });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Break" }));
    const picker = await screen.findByTestId("break-type-picker");
    expect(picker).toHaveTextContent("Rest");
    expect(picker).toHaveTextContent("Paid · 10 min");
    expect(picker).toHaveTextContent("Unpaid · 30 min");
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Meal/ }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "break_start", breakTypeId: 8 })]));
    expect(screen.queryByTestId("break-type-picker")).not.toBeInTheDocument();
  });

  it("sends nothing when the picker is cancelled", async () => {
    const { posts } = mockApi({ todayPunches: clockedIn, breakTypes: twoTypes });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Break" }));
    await screen.findByTestId("break-type-picker");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("break-type-picker")).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("starts the one break type straight away", async () => {
    const { posts } = mockApi({ todayPunches: clockedIn, breakTypes: [twoTypes[1]] });
    render(<ClockPageClient />);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith("/api/break-types"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Start Break" }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "break_start", breakTypeId: 8 })]));
    expect(screen.queryByTestId("break-type-picker")).not.toBeInTheDocument();
  });

  it("starts a plain break with no type when none are set up (today's behavior)", async () => {
    const { posts } = mockApi({ todayPunches: clockedIn });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Break" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ punchType: "break_start" });
    expect(posts[0]).not.toHaveProperty("breakTypeId");
  });
});

describe("Clock — break attestation at clock-out", () => {
  it("doesn't ask when the setting is off", async () => {
    const { posts } = mockApi({ todayPunches: clockedIn });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "End Shift" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("breaksAttested");
    expect(screen.queryByText(/Were you able to take your breaks/)).not.toBeInTheDocument();
  });

  it.each([
    ["Yes, I took them", true],
    ["No, I couldn't", false],
  ])("asks when the setting is on and sends the answer (%s)", async (label, answer) => {
    settings = { ...settings, breakRules: { mealRequiredAfterMinutes: 0, attestationEnabled: true } };
    const { posts } = mockApi({ todayPunches: clockedIn });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "End Shift" }));
    expect(await screen.findByText(/Were you able to take your breaks/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "clock_out", breaksAttested: answer })]));
  });

  it("stays clocked in when the question is cancelled", async () => {
    settings = { ...settings, breakRules: { mealRequiredAfterMinutes: 0, attestationEnabled: true } };
    const { posts } = mockApi({ todayPunches: clockedIn });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "End Shift" }));
    await screen.findByText(/Were you able to take your breaks/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Were you able to take your breaks/)).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
    expect(screen.getByRole("button", { name: "End Shift" })).toBeInTheDocument();
  });
});
