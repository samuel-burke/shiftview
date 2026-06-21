import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PunctualityReport, { type PunctualityRow } from "./PunctualityReport";

const rows: PunctualityRow[] = [
  { employeeId: 1, employeeName: "Alex", scheduledStartMinutes: 540, clockInMinutes: 543, status: "on_time" },
  { employeeId: 2, employeeName: "Jordan", scheduledStartMinutes: 540, clockInMinutes: 560, status: "late" },
  { employeeId: 3, employeeName: "Sam", scheduledStartMinutes: 600, clockInMinutes: null, status: "absent" },
];

const summary = { total: 3, onTime: 1, late: 1, absent: 1, onTimeRate: 50 };

describe("PunctualityReport", () => {
  it("summarizes the on-time rate and no-shows", () => {
    render(<PunctualityReport rows={rows} summary={summary} />);
    expect(screen.getByTestId("punctuality-rate")).toHaveTextContent("50% on time · 1 no-show");
  });

  it("labels each employee's status", () => {
    render(<PunctualityReport rows={rows} summary={summary} />);
    expect(within(screen.getByTestId("punctuality-row-1")).getByText("On time")).toBeInTheDocument();
    expect(within(screen.getByTestId("punctuality-row-2")).getByText("Late")).toBeInTheDocument();
    expect(within(screen.getByTestId("punctuality-row-3")).getByText("No-show")).toBeInTheDocument();
  });

  it("omits clock-in time for a no-show", () => {
    render(<PunctualityReport rows={rows} summary={summary} />);
    expect(within(screen.getByTestId("punctuality-row-3")).queryByText(/· In/)).not.toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<PunctualityReport rows={[]} summary={{ total: 0, onTime: 0, late: 0, absent: 0, onTimeRate: 0 }} />);
    expect(screen.getByText(/no shifts scheduled/i)).toBeInTheDocument();
  });
});
