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
function mockApi({ corrections = [] as Correction[], putStatus = 202 } = {}) {
  const puts: unknown[] = [];
  let currentCorrections = corrections;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ isManager: false, employeeId: 5, employeeName: "Alex Kim" });
    if (url.startsWith("/api/schedules")) return json([]);
    if (url.startsWith("/api/punches/missed")) {
      return json({
        missedPunch: {
          date: "2026-10-31",
          lastPunchType: "clock_in",
          lastPunchedAt: "2026-10-31T13:00:00Z",
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
    if (url.startsWith("/api/punches")) return json([]);
    if (url.startsWith("/api/punch-corrections")) return json({ corrections: currentCorrections });
    if (url.startsWith("/api/callouts")) return json({ callouts: [] });
    return json({});
  }));
  return { puts };
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
