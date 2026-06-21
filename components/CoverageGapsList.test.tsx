import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CoverageGapsList, { type DayGaps } from "./CoverageGapsList";

const days: DayGaps[] = [
  { date: "2026-06-15", gaps: [{ date: "2026-06-15", startMinutes: 480, endMinutes: 600, shortfall: 2 }] },
  { date: "2026-06-16", gaps: [] },
  { date: "2026-06-17", gaps: [{ date: "2026-06-17", startMinutes: 720, endMinutes: 900, shortfall: 3 }] },
];

const summary = { totalGaps: 2, totalGapMinutes: 300, daysWithGaps: 2, worstShortfall: 3 };

describe("CoverageGapsList", () => {
  it("shows a clear state when there are no gaps", () => {
    render(<CoverageGapsList days={days} summary={{ totalGaps: 0, totalGapMinutes: 0, daysWithGaps: 0, worstShortfall: 0 }} />);
    expect(screen.getByTestId("coverage-gaps-clear")).toBeInTheDocument();
  });

  it("summarizes how many days are short", () => {
    render(<CoverageGapsList days={days} summary={summary} />);
    expect(screen.getByText("2 days short")).toBeInTheDocument();
  });

  it("renders only the days that have gaps", () => {
    render(<CoverageGapsList days={days} summary={summary} />);
    expect(screen.getByTestId("coverage-day-2026-06-15")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-day-2026-06-17")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-day-2026-06-16")).not.toBeInTheDocument();
  });

  it("shows each gap's shortfall", () => {
    render(<CoverageGapsList days={days} summary={summary} />);
    expect(within(screen.getByTestId("coverage-day-2026-06-17")).getByText("short 3")).toBeInTheDocument();
  });
});
