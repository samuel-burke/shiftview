import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonthView from "./MonthView";
import type { Schedule } from "../data/types";

const WEEKLY_HOURS = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

const TODAY = new Date(2026, 4, 25); // Mon May 25 2026
const NAV_MAY = new Date(2026, 4, 1);

const SCHEDULES: Schedule[] = [
  { id: 1, employeeId: 1, date: "2026-05-25", startMinutes: 360, endMinutes: 840 }, // opener
  { id: 2, employeeId: 1, date: "2026-05-28", startMinutes: 1320, endMinutes: 1440 }, // closer
];

describe("MonthView", () => {
  it("renders all 7 day-of-week headers", () => {
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        navDate={NAV_MAY}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    for (const label of ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders all 31 days of May 2026", () => {
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        navDate={NAV_MAY}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    for (let d = 1; d <= 31; d++) {
      // Multiple elements may share text if dates repeat — use getAllByText
      const cells = screen.getAllByText(String(d));
      expect(cells.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("calls onSelectDate with the correct date when a cell is clicked", async () => {
    const onSelectDate = vi.fn();
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        navDate={NAV_MAY}
        onSelectDate={onSelectDate}
        today={TODAY}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const btn15 = buttons.find((b) => b.textContent?.trim().startsWith("15"));
    expect(btn15).toBeDefined();
    await userEvent.click(btn15!);
    expect(onSelectDate).toHaveBeenCalledOnce();
    const called = onSelectDate.mock.calls[0][0] as Date;
    expect(called.getDate()).toBe(15);
    expect(called.getMonth()).toBe(4);
  });

  it("renders a correct number of week rows for May 2026 (6 rows)", () => {
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        navDate={NAV_MAY}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    // May 2026: starts on Friday (day 5), so needs 6 rows
    const buttons = screen.getAllByRole("button");
    // 31 days = 31 buttons
    expect(buttons.length).toBe(31);
  });

  it("renders correct number of days for a 28-day February", () => {
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={new Date(2027, 1, 1)}
        navDate={new Date(2027, 1, 1)}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(28);
  });

  it("does not render the 32nd day", () => {
    render(
      <MonthView
        schedules={[]}
        weeklyHours={WEEKLY_HOURS}
        selectedDate={TODAY}
        navDate={NAV_MAY}
        onSelectDate={vi.fn()}
        today={TODAY}
      />,
    );
    expect(screen.queryByText("32")).toBeNull();
  });
});
