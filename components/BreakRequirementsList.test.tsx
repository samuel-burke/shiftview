import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BreakRequirementsList, { type BreakShift } from "./BreakRequirementsList";

const shifts: BreakShift[] = [
  { scheduleId: 1, employeeName: "Alex P", startMinutes: 480, endMinutes: 1020, durationMinutes: 540, mealBreakRequired: true, restBreaks: 2 },
  { scheduleId: 2, employeeName: "Jordan K", startMinutes: 540, endMinutes: 900, durationMinutes: 360, mealBreakRequired: false, restBreaks: 1 },
];

const summary = { totalShifts: 2, mealBreaksRequired: 1, restBreaksRequired: 3 };

describe("BreakRequirementsList", () => {
  it("summarizes how many meal breaks are required", () => {
    render(<BreakRequirementsList shifts={shifts} summary={summary} />);
    expect(screen.getByText("1 meal break")).toBeInTheDocument();
  });

  it("badges only shifts that require a meal break", () => {
    render(<BreakRequirementsList shifts={shifts} summary={summary} />);
    expect(within(screen.getByTestId("break-shift-1")).getByText("Meal break")).toBeInTheDocument();
    expect(within(screen.getByTestId("break-shift-2")).queryByText("Meal break")).not.toBeInTheDocument();
  });

  it("shows rest-break counts", () => {
    render(<BreakRequirementsList shifts={shifts} summary={summary} />);
    expect(within(screen.getByTestId("break-shift-1")).getByText("2 rest")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is scheduled", () => {
    render(<BreakRequirementsList shifts={[]} summary={{ totalShifts: 0, mealBreaksRequired: 0, restBreaksRequired: 0 }} />);
    expect(screen.getByText(/no shifts scheduled/i)).toBeInTheDocument();
  });
});
