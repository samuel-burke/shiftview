import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WeeklyHoursSummary, { type WeeklyHoursRow } from "./WeeklyHoursSummary";

const rows: WeeklyHoursRow[] = [
  { employeeId: 1, employeeName: "Alex P", totalMinutes: 2700, totalHours: 45, overtimeMinutes: 300, isOvertime: true },
  { employeeId: 2, employeeName: "Jordan K", totalMinutes: 1920, totalHours: 32, overtimeMinutes: 0, isOvertime: false },
];

describe("WeeklyHoursSummary", () => {
  it("renders an empty state when no one is scheduled", () => {
    render(<WeeklyHoursSummary employees={[]} />);
    expect(screen.getByText(/no one scheduled/i)).toBeInTheDocument();
  });

  it("shows each employee's total hours", () => {
    render(<WeeklyHoursSummary employees={rows} />);
    expect(within(screen.getByTestId("weekly-hours-row-1")).getByText("45h")).toBeInTheDocument();
    expect(within(screen.getByTestId("weekly-hours-row-2")).getByText("32h")).toBeInTheDocument();
  });

  it("badges only employees scheduled into overtime", () => {
    render(<WeeklyHoursSummary employees={rows} />);
    const alex = screen.getByTestId("weekly-hours-row-1");
    expect(within(alex).getByText(/OT \+5h/)).toBeInTheDocument();
    const jordan = screen.getByTestId("weekly-hours-row-2");
    expect(within(jordan).queryByText(/OT/)).not.toBeInTheDocument();
  });

  it("summarizes how many employees are in overtime", () => {
    render(<WeeklyHoursSummary employees={rows} />);
    expect(screen.getByText(/1 in overtime/i)).toBeInTheDocument();
  });

  it("formats partial overtime hours with minutes", () => {
    render(
      <WeeklyHoursSummary
        employees={[
          { employeeId: 3, employeeName: "Sam B", totalMinutes: 2490, totalHours: 41.5, overtimeMinutes: 90, isOvertime: true },
        ]}
      />
    );
    expect(screen.getByText(/OT \+1h 30m/)).toBeInTheDocument();
  });
});
