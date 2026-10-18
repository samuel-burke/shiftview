import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ClockPageClient from "./clockPageClient";

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

type Correction = { id: number; punchType: string; punchedAt: string; note: string; status: string; reviewNote: string | null };

// Employee Alex (id 5) whose shift from Oct 31 was never clocked out.
function mockApi({
  corrections = [] as Correction[],
  putStatus = 202,
  schedules = [] as Record<string, unknown>[],
  todayPunches = [] as Record<string, unknown>[],
  missedPunch = true,
  missedLastPunchedAt = "2026-10-31T13:00:00Z",
  current = { carriedOver: false, punches: [] } as { carriedOver: boolean; punches: Record<string, unknown>[] },
  // Answers a live punch (POST); defaults to recording it.
  onPost = undefined as undefined | ((body: Record<string, unknown>) => { status: number; data: unknown }),
  timecard = { days: [], weeks: [] } as Record<string, unknown>,
} = {}) {
  const puts: unknown[] = [];
  const posts: Record<string, unknown>[] = [];
  const reads = { punches: 0 };
  let currentCorrections = corrections;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ isManager: false, employeeId: 5, employeeName: "Alex Kim" });
    if (url.startsWith("/api/schedules")) {
      const date = new URL(url, "http://x").searchParams.get("date");
      return json(schedules.filter((s) => !s.date || s.date === date));
    }
    if (url.startsWith("/api/punches/missed")) {
      if (!missedPunch) return json({ missedPunch: null });
      return json({
        missedPunch: {
          date: "2026-10-31",
          lastPunchType: "clock_in",
          lastPunchedAt: missedLastPunchedAt,
          suggestedPunchType: "clock_out",
        },
      });
    }
    if (url.startsWith("/api/punches") && init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      currentCorrections = [
        { id: 9, punchType: "clock_out", punchedAt: "2026-10-31T21:00:00Z", note: "Forgot", status: "pending", reviewNote: null },
      ];
      return json({ ok: true, pending: true, correctionId: 9 }, putStatus);
    }
    if (url.startsWith("/api/punches") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (onPost) {
        const r = onPost(body);
        return json(r.data, r.status);
      }
      return json({ id: 50 + posts.length, employeeId: 5, scheduleId: body.scheduleId ?? null, punchType: body.punchType,
        punchedAt: new Date().toISOString(), lat: null, lng: null, isManual: false, note: null }, 201);
    }
    if (url.startsWith("/api/punches/current")) return json(current);
    if (url.startsWith("/api/punches")) { reads.punches++; return json(todayPunches); }
    if (url.startsWith("/api/punch-corrections")) return json({ corrections: currentCorrections });
    if (url.startsWith("/api/callouts")) return json({ callouts: [] });
    if (url.startsWith("/api/timecard")) return json(timecard);
    return json({});
  }));
  return { puts, posts, reads };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Clock — punch corrections need manager approval", () => {
  it("sends a missed clock-out for approval and shows it as pending", async () => {
    const { puts } = mockApi();
    render(<ClockPageClient />);

    // The missed-punch banner's button (the form toggle carries the same label).
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Missing Clock-Out" }))[0]);
    expect(screen.getByText(/Your manager reviews corrections/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Forgot" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for Approval" }));

    // The store-local wall time goes to the server, not a browser-computed instant.
    await waitFor(() => expect(puts).toEqual([
      expect.objectContaining({ punchType: "clock_out", localDate: "2026-10-31", localTime: "17:00", note: "Forgot" }),
    ]));
    expect(await screen.findByText(/Sent to your manager for approval/i)).toBeInTheDocument();
    expect(await screen.findByText(/waiting for manager approval/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Add Missing Clock-Out" })).toHaveLength(0);
    const list = await screen.findByTestId("my-punch-corrections");
    expect(list).toHaveTextContent("Clock Out");
    expect(list).toHaveTextContent("Sat, Oct 31 at 5:00 PM");
    expect(list).toHaveTextContent("Pending");
  });

  it("shows a denied request with the manager's note", async () => {
    mockApi({
      corrections: [
        { id: 3, punchType: "clock_out", punchedAt: "2026-10-31T23:00:00Z", note: "Forgot", status: "denied", reviewNote: "You left at 5" },
      ],
    });
    render(<ClockPageClient />);
    const list = await screen.findByTestId("my-punch-corrections");
    expect(list).toHaveTextContent("Denied");
    expect(list).toHaveTextContent("Manager: You left at 5");
    // A denied request doesn't cover the open shift — the employee can try again.
    expect(screen.getAllByRole("button", { name: "Add Missing Clock-Out" }).length).toBeGreaterThan(0);
  });
});

describe("Clock — call-out button", () => {
  const todaysShift = { id: 1, employeeId: 5, date: "2026-11-01", startMinutes: 540, endMinutes: 1020 };
  const callOutButton = () => screen.queryByRole("button", { name: /Can.t make it in today\? Call out/ });

  it("offers a call-out for today's scheduled shift before clocking in", async () => {
    mockApi({ missedPunch: false, schedules: [todaysShift] });
    render(<ClockPageClient />);
    await waitFor(() => expect(callOutButton()).toBeInTheDocument());
  });

  it("hides it when there's no shift today", async () => {
    mockApi({ missedPunch: false, schedules: [] });
    render(<ClockPageClient />);
    await screen.findByText(/No shift scheduled today/i);
    expect(callOutButton()).not.toBeInTheDocument();
  });

  it("hides it once clocked in for today's shift", async () => {
    mockApi({
      missedPunch: false,
      schedules: [todaysShift],
      todayPunches: [{ id: 1, employeeId: 5, punchType: "clock_in", punchedAt: "2026-11-01T14:00:00Z", isManual: false }],
    });
    render(<ClockPageClient />);
    await screen.findByText(/Clocked In/i);
    expect(callOutButton()).not.toBeInTheDocument();
  });
});

describe("Clock — closing past midnight", () => {
  it("shows yesterday's open shift with End Shift after midnight", async () => {
    vi.setSystemTime(new Date("2026-11-02T05:30:00Z")); // 12:30 AM EST, Nov 2
    mockApi({
      missedPunch: false,
      schedules: [],
      todayPunches: [],
      current: {
        carriedOver: true,
        punches: [{ id: 7, employeeId: 5, punchType: "clock_in", punchedAt: "2026-11-01T21:00:00Z", isManual: false, note: null }],
      },
    });
    render(<ClockPageClient />);
    expect(await screen.findByText("Shift from yesterday")).toBeInTheDocument();
    expect(screen.queryByText(/No shift scheduled today/i)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "End Shift" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clock In" })).not.toBeInTheDocument();
    // No call-out for a shift you're already working.
    expect(screen.queryByRole("button", { name: /Can.t make it in today\? Call out/ })).not.toBeInTheDocument();
  });
});

describe("Clock — scheduled overnight shift", () => {
  const night = { id: 9, employeeId: 5, date: "2026-11-01", startMinutes: 1320, endMinutes: 1800 }; // 10 PM – 6 AM

  it("shows yesterday's overnight shift after midnight, without a call-out", async () => {
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z")); // 3:00 AM EST, Nov 2
    mockApi({
      missedPunch: false,
      schedules: [night],
      current: {
        carriedOver: true,
        punches: [{ id: 7, employeeId: 5, punchType: "clock_in", punchedAt: "2026-11-02T03:00:00Z", isManual: false, note: null }],
      },
    });
    render(<ClockPageClient />);
    expect(await screen.findByTestId("shift-started-yesterday")).toBeInTheDocument();
    expect(screen.getByText(/10:00 PM – 6:00 AM/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "End Shift" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Can.t make it in today\? Call out/ })).not.toBeInTheDocument();
  });

  it("shows tonight's overnight shift as ending tomorrow", async () => {
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z")); // 3:00 PM EST, Nov 1
    mockApi({ missedPunch: false, schedules: [night] });
    render(<ClockPageClient />);
    expect(await screen.findByText("Ends tomorrow morning")).toBeInTheDocument();
  });
});

describe("Clock — split shift", () => {
  // 8 AM – 12 PM and 4 PM – 8 PM on Nov 1 (EST after the fall-back).
  const morning = { id: 1, employeeId: 5, date: "2026-11-01", startMinutes: 480, endMinutes: 720 };
  const afternoon = { id: 2, employeeId: 5, date: "2026-11-01", startMinutes: 960, endMinutes: 1200 };

  it("clocks in to the afternoon shift at 4 PM, without a late warning for the morning one", async () => {
    vi.setSystemTime(new Date("2026-11-01T21:00:00Z")); // 4:00 PM EST
    const { posts } = mockApi({ missedPunch: false, schedules: [morning, afternoon] });
    render(<ClockPageClient />);
    expect(await screen.findByText(/4:00 PM – 8:00 PM/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "clock_in", scheduleId: 2 })]));
    expect(screen.queryByText("Late Clock-In")).not.toBeInTheDocument();
  });
});

describe("Clock — a refused punch", () => {
  it("reloads after a 409 so the screen shows the real state", async () => {
    const todayPunches: Record<string, unknown>[] = [];
    const { reads } = mockApi({
      missedPunch: false,
      todayPunches,
      onPost: () => {
        // The punch landed on an earlier request whose response was lost.
        todayPunches.push({ id: 7, employeeId: 5, scheduleId: null, punchType: "clock_in", punchedAt: "2026-11-01T14:59:00Z", isManual: false, note: null });
        return { status: 409, data: { error: "Cannot clock_in: current state is clock_in" } };
      },
    });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/current state is clock_in/)).toBeInTheDocument();
    await waitFor(() => expect(reads.punches).toBeGreaterThan(1));
    expect(await screen.findByRole("button", { name: "End Shift" })).toBeInTheDocument();
  });
});

describe("Clock — late badge follows the punch policy", () => {
  const shift = { id: 1, employeeId: 5, date: "2026-11-01", startMinutes: 540, endMinutes: 1020 }; // 9–5

  it("shows no badge 6 minutes late — the default policy flags more than 6", async () => {
    mockApi({
      missedPunch: false,
      schedules: [shift],
      todayPunches: [{ id: 1, employeeId: 5, scheduleId: 1, punchType: "clock_in", punchedAt: "2026-11-01T14:06:00Z", isManual: false }],
    });
    render(<ClockPageClient />);
    await screen.findByRole("button", { name: "End Shift" });
    expect(screen.queryByText("6m late")).not.toBeInTheDocument();
  });

  it("shows the badge past the threshold", async () => {
    mockApi({
      missedPunch: false,
      schedules: [shift],
      todayPunches: [{ id: 1, employeeId: 5, scheduleId: 1, punchType: "clock_in", punchedAt: "2026-11-01T14:07:00Z", isManual: false }],
    });
    render(<ClockPageClient />);
    expect(await screen.findByText("7m late")).toBeInTheDocument();
  });
});

describe("Clock — overnight missed clock-out", () => {
  it("dates a clock-out earlier than the open clock-in to the next morning", async () => {
    // Clocked in Oct 31 at 10 PM EDT; never clocked out.
    const { puts } = mockApi({ missedLastPunchedAt: "2026-11-01T02:00:00Z" });
    render(<ClockPageClient />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Missing Clock-Out" }))[0]);
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "06:00" } });
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-01");
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "23:15" } });
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-31");
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "06:00" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Forgot" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for Approval" }));
    await waitFor(() => expect(puts).toEqual([
      expect.objectContaining({ punchType: "clock_out", localDate: "2026-11-01", localTime: "06:00" }),
    ]));
  });
});

describe("Clock — my hours", () => {
  it("shows the employee their own hours this week", async () => {
    mockApi({
      missedPunch: false,
      timecard: {
        days: [{
          date: "2026-10-26", dayName: "Mon", schedule: null, schedules: [], punches: [], callout: null,
          workedHours: 8, breakHours: 0.5, breakCount: 1, hasIncomplete: false, violations: [],
        }],
        weeks: [{
          weekStart: "2026-10-26", priorHours: 0, regularHours: 37, overtimeHours: 0, breakHours: 2,
          totalWorkedHours: 37, hasIncomplete: false, days: [],
        }],
      },
    });
    render(<ClockPageClient />);
    // Sunday Nov 1 is the last day of the workweek that began Monday Oct 26.
    expect(await screen.findByTestId("my-hours-worked")).toHaveTextContent("37h");
    expect(screen.getByText(/3h until overtime/)).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/timecard?employeeId=5&from=2026-10-19&to=2026-11-01");
  });
});

describe("Clock — a note on a live punch", () => {
  it("sends the typed note with the punch and clears it after", async () => {
    const { posts } = mockApi({ missedPunch: false });
    render(<ClockPageClient />);
    const input = await screen.findByTestId("punch-note");
    expect(input).toHaveAttribute("maxLength", "140");
    fireEvent.change(input, { target: { value: "  Covering for Sam " } });
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(posts).toEqual([expect.objectContaining({ punchType: "clock_in", note: "Covering for Sam" })]));
    await waitFor(() => expect(screen.getByTestId("punch-note")).toHaveValue(""));
  });

  it("sends no note field when the box is empty", async () => {
    const { posts } = mockApi({ missedPunch: false });
    render(<ClockPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("note");
  });

  it("keeps the note when the punch is refused, so it can be sent again", async () => {
    mockApi({ missedPunch: false, onPost: () => ({ status: 422, data: { error: "Outside geofence" } }) });
    render(<ClockPageClient />);
    fireEvent.change(await screen.findByTestId("punch-note"), { target: { value: "Parking lot" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/Outside geofence/)).toBeInTheDocument();
    expect(screen.getByTestId("punch-note")).toHaveValue("Parking lot");
  });

  it("shows the note on today's punch list", async () => {
    mockApi({
      missedPunch: false,
      todayPunches: [{ id: 1, employeeId: 5, scheduleId: null, punchType: "clock_in", punchedAt: "2026-11-01T14:00:00Z", isManual: false, note: null, employeeNote: "Bus was late" }],
    });
    render(<ClockPageClient />);
    expect(await screen.findByText("“Bus was late”")).toBeInTheDocument();
  });
});
