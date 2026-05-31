import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeekView from "./WeekView";
import type { Schedule, TimeOffRequest } from "../data/types";

const WEEKLY_HOURS = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

// Mon May 25 2026 is a Monday (getDay() === 1)
const TODAY = new Date(2026, 4, 25); // month is 0-indexed
// Week containing May 25 starts on Sun May 24
const WEEK_START = new Date(2026, 4, 24);

const SCHEDULES: Schedule[] = [
  // Monday May 25 — opener (starts before 7am threshold? No, 480 = 8am → mid threshold)
  // Actually 480 = 8:00 AM which is > 420 (7am), so mid. Let's use an early shift.
  { id: 1, employeeId: 1, date: "2026-05-25", startMinutes: 360, endMinutes: 840 }, // 6am–2pm → opener
  { id: 2, employeeId: 1, date: "2026-05-28", startMinutes: 720, endMinutes: 1200 }, // 12pm–8pm → mid
];

describe("WeekView", () => {
  it("renders all 7 day-of-week labels", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    for (const label of ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders date numbers 24–30 for the week", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    for (let d = 24; d <= 30; d++) {
      expect(screen.getByText(String(d))).toBeInTheDocument();
    }
  });

  it("shows EARLY label for an opener shift", () => {
    render(
      <WeekView
        schedules={SCHEDULES}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    expect(screen.getByText("EARLY")).toBeInTheDocument();
  });

  it("shows MID label for a mid shift", () => {
    render(
      <WeekView
        schedules={SCHEDULES}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    expect(screen.getByText("MID")).toBeInTheDocument();
  });

  it("shows Off label for days with no schedule", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    const offLabels = screen.getAllByText("Off");
    expect(offLabels.length).toBe(7);
  });

  it("calls onSelectDate with the correct date when a tile is clicked", async () => {
    const onSelectDate = vi.fn();
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={onSelectDate}
        today={TODAY}
      />,
    );
    // Click the "26" tile (Tuesday)
    await userEvent.click(screen.getByText("26"));
    expect(onSelectDate).toHaveBeenCalledOnce();
    const called = onSelectDate.mock.calls[0][0] as Date;
    expect(called.getDate()).toBe(26);
    expect(called.getMonth()).toBe(4); // May
  });

  it("shows the short time range for scheduled days", () => {
    render(
      <WeekView
        schedules={SCHEDULES}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    // 360 min = 6am → "6a", 840 min = 2pm → "2p"
    expect(screen.getByText("6a–2p")).toBeInTheDocument();
  });
});

// ── Time-off request indicators ────────────────────────────────────────────────

describe("WeekView time-off indicators", () => {
  // May 26 2026 is a Tuesday (within WEEK_START May 24)
  const pendingRequest: TimeOffRequest = { id: 1, date: "2026-05-26", status: "pending" };
  const approvedRequest: TimeOffRequest = { id: 2, date: "2026-05-26", status: "approved" };
  const deniedRequest: TimeOffRequest = { id: 3, date: "2026-05-26", status: "denied" };

  it("shows 'REQ' label for a pending time-off request on a day with no shift", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
        timeOffRequests={[pendingRequest]}
      />,
    );
    expect(screen.getByText("REQ")).toBeInTheDocument();
  });

  it("shows 'APR' label for an approved time-off request", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
        timeOffRequests={[approvedRequest]}
      />,
    );
    expect(screen.getByText("APR")).toBeInTheDocument();
  });

  it("shows 'DEN' label for a denied time-off request", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
        timeOffRequests={[deniedRequest]}
      />,
    );
    expect(screen.getByText("DEN")).toBeInTheDocument();
  });

  it("does not show time-off label when a shift is scheduled that day", () => {
    const shiftOnTuesday: Schedule = {
      id: 99, employeeId: 1, date: "2026-05-26", startMinutes: 480, endMinutes: 960,
    };
    render(
      <WeekView
        schedules={[shiftOnTuesday]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
        timeOffRequests={[pendingRequest]}
      />,
    );
    expect(screen.queryByText("REQ")).not.toBeInTheDocument();
  });

  it("renders normally without timeOffRequests prop", () => {
    render(
      <WeekView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        weekStart={WEEK_START}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    expect(screen.queryByText("REQ")).not.toBeInTheDocument();
    expect(screen.queryByText("APR")).not.toBeInTheDocument();
  });
});
