import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WeekCoverageHeatmap from "./WeekCoverageHeatmap";

const MON = "2026-10-12";
const TUE = "2026-10-13";
// 9 AM – noon, one person needed.
const CURVES = { [MON]: [{ startMinutes: 540, endMinutes: 720, headcount: 1 }], [TUE]: [{ startMinutes: 540, endMinutes: 720, headcount: 1 }] };

describe("WeekCoverageHeatmap", () => {
  it("says when there is nothing to show", () => {
    render(<WeekCoverageHeatmap shifts={[]} dates={[MON, TUE]} curves={{}} />);
    expect(screen.getByText("No coverage targets or shifts this week")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("labels every hour with its numbers", () => {
    render(
      <WeekCoverageHeatmap
        shifts={[{ date: MON, startMinutes: 540, endMinutes: 660 }]} // Monday 9–11
        dates={[MON, TUE]}
        curves={CURVES}
      />
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // the hour labels and two days
    expect(screen.getByRole("gridcell", { name: "Monday 9:00 AM–10:00 AM: 1 scheduled, 1 needed, target met" }))
      .toHaveAttribute("data-kind", "met");
    expect(screen.getByRole("gridcell", { name: "Monday 11:00 AM–12:00 PM: 0 scheduled, 1 needed, short by 1" }))
      .toHaveAttribute("data-kind", "short");
    // Tuesday has nobody: three short hours, plus Monday's last one.
    expect(screen.getByText("4 short hours")).toBeInTheDocument();
  });

  it("counts hours with more people than needed", () => {
    render(
      <WeekCoverageHeatmap
        shifts={[
          { date: MON, startMinutes: 540, endMinutes: 720 },
          { date: MON, startMinutes: 540, endMinutes: 600 },
          { date: TUE, startMinutes: 540, endMinutes: 720 },
        ]}
        dates={[MON, TUE]}
        curves={CURVES}
      />
    );
    expect(screen.getByText("No gaps · 1 over")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /Monday 9:00 AM–10:00 AM: 2 scheduled, 1 needed, over by 1/ }))
      .toHaveAttribute("data-kind", "over");
  });

  it("moves through the hours with the arrow keys and reads each one out", () => {
    render(<WeekCoverageHeatmap shifts={[]} dates={[MON, TUE]} curves={CURVES} />);
    const grid = screen.getByRole("grid");
    expect(screen.getByText("Hover or tap an hour for details")).toBeInTheDocument();

    fireEvent.focus(grid);
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-0-0");
    expect(screen.getByText("Monday 9:00 AM–10:00 AM: 0 scheduled, 1 needed, short by 1")).toBeInTheDocument();

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-1-1");
    expect(screen.getByText("Tuesday 10:00 AM–11:00 AM: 0 scheduled, 1 needed, short by 1")).toBeInTheDocument();

    fireEvent.keyDown(grid, { key: "End" });
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-1-2");
    fireEvent.keyDown(grid, { key: "ArrowRight" }); // stays on the last hour
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-1-2");
    fireEvent.keyDown(grid, { key: "Home" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-0-0");
  });

  it("shows an hour's numbers on hover", () => {
    render(<WeekCoverageHeatmap shifts={[]} dates={[MON, TUE]} curves={CURVES} />);
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: /Tuesday 11:00 AM/ }));
    expect(screen.getByText("Tuesday 11:00 AM–12:00 PM: 0 scheduled, 1 needed, short by 1")).toBeInTheDocument();
  });
});
