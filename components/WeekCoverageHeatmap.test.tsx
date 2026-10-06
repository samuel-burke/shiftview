import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    expect(screen.queryByRole("tab", { name: "List" })).toBeNull();
  });

  it("labels every hour with its numbers", () => {
    render(
      <WeekCoverageHeatmap
        shifts={[{ date: MON, startMinutes: 540, endMinutes: 660 }]} // Monday 9–11
        dates={[MON, TUE]}
        curves={CURVES}
      />
    );
    expect(screen.getByRole("heading", { name: "Coverage by Hour" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // the hour labels and two days
    expect(screen.getByRole("gridcell", { name: "Monday 9–10 AM: 1 of 1 scheduled · target met" }))
      .toHaveAttribute("data-kind", "met");
    expect(screen.getByRole("gridcell", { name: "Monday 11 AM–12 PM: 0 of 1 scheduled · short by 1" }))
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
    expect(screen.getByRole("gridcell", { name: "Monday 9–10 AM: 2 of 1 scheduled · over by 1" }))
      .toHaveAttribute("data-kind", "over");
  });

  it("marks hours no one is needed", () => {
    render(
      <WeekCoverageHeatmap
        shifts={[]}
        dates={[MON, TUE]}
        curves={{ [MON]: CURVES[MON], [TUE]: [{ startMinutes: 600, endMinutes: 720, headcount: 1 }] }}
      />
    );
    expect(screen.getByRole("gridcell", { name: "Tuesday 9–10 AM: no one needed" })).toHaveAttribute("data-kind", "empty");
    expect(screen.getByText("No one needed")).toBeInTheDocument();
  });

  it("moves through the hours with the arrow keys and reads each one out", () => {
    render(<WeekCoverageHeatmap shifts={[]} dates={[MON, TUE]} curves={CURVES} />);
    const grid = screen.getByRole("grid");
    expect(screen.getByText("Hover or tap an hour for details")).toBeInTheDocument();

    fireEvent.focus(grid);
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-0-0");
    expect(screen.getByText("Mon 9–10 AM")).toBeInTheDocument();

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).toHaveAttribute("aria-activedescendant", "heat-1-1");
    expect(screen.getByText("Tue 10–11 AM")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 scheduled · short by 1")).toBeInTheDocument();

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
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: /Tuesday 11 AM/ }));
    expect(screen.getByText("Tue 11 AM–12 PM")).toBeInTheDocument();
  });

  it("follows the Planner's selected day and selects the day of a tapped hour", () => {
    const onSelectDate = vi.fn();
    render(<WeekCoverageHeatmap shifts={[]} dates={[MON, TUE]} curves={CURVES} selectedDate={TUE} onSelectDate={onSelectDate} />);
    const [, monRow, tueRow] = screen.getAllByRole("row");
    expect(tueRow).toHaveAttribute("aria-selected", "true");
    expect(monRow).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("gridcell", { name: /Monday 10–11 AM/ }));
    expect(onSelectDate).toHaveBeenCalledWith(MON);
  });

  it("lists each day's hours off target", () => {
    const onSelectDate = vi.fn();
    render(
      <WeekCoverageHeatmap
        shifts={[
          { date: MON, startMinutes: 540, endMinutes: 720 },
          { date: MON, startMinutes: 600, endMinutes: 720 }, // 10–12: one extra
        ]}
        dates={[MON, TUE]}
        curves={CURVES}
        onSelectDate={onSelectDate}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.queryByRole("grid")).toBeNull();
    const list = screen.getByRole("list", { name: "Hours off target by day" });
    const [mon, tue] = within(list).getAllByRole("listitem");
    expect(mon).toHaveTextContent("10 AM–12 PM+1");
    expect(tue).toHaveTextContent("9 AM–12 PMshort 1");

    fireEvent.click(within(tue).getByRole("button", { name: "Select Tuesday" }));
    expect(onSelectDate).toHaveBeenCalledWith(TUE);
  });

  it("says when a day's hours are all covered", () => {
    render(
      <WeekCoverageHeatmap
        shifts={[{ date: MON, startMinutes: 540, endMinutes: 720 }, { date: TUE, startMinutes: 540, endMinutes: 720 }]}
        dates={[MON, TUE]}
        curves={CURVES}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.getAllByText("✓ Every hour covered")).toHaveLength(2);
  });
});
