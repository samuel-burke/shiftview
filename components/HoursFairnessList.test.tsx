import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import HoursFairnessList, { type FairnessRowView } from "./HoursFairnessList";

const employees: FairnessRowView[] = [
  { employeeId: 1, employeeName: "Alex P", totalHours: 40, deviationMinutes: 900, status: "over" },
  { employeeId: 2, employeeName: "Jordan K", totalHours: 10, deviationMinutes: -900, status: "under" },
];

const summary = { count: 2, meanMinutes: 1500, spreadMinutes: 1800 };

describe("HoursFairnessList", () => {
  it("shows the team average and spread", () => {
    render(<HoursFairnessList employees={employees} summary={summary} />);
    expect(screen.getByText(/avg 25h · spread 30h/)).toBeInTheDocument();
  });

  it("labels each employee's fairness status", () => {
    render(<HoursFairnessList employees={employees} summary={summary} />);
    expect(within(screen.getByTestId("fairness-row-1")).getByText("Over")).toBeInTheDocument();
    expect(within(screen.getByTestId("fairness-row-2")).getByText("Under")).toBeInTheDocument();
  });

  it("shows signed deviation from the mean", () => {
    render(<HoursFairnessList employees={employees} summary={summary} />);
    expect(within(screen.getByTestId("fairness-row-1")).getByText("+15h")).toBeInTheDocument();
    expect(within(screen.getByTestId("fairness-row-2")).getByText("-15h")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<HoursFairnessList employees={[]} summary={{ count: 0, meanMinutes: 0, spreadMinutes: 0 }} />);
    expect(screen.getByText(/no one scheduled/i)).toBeInTheDocument();
  });
});
