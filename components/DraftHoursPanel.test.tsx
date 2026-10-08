import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DraftHoursPanel from "./DraftHoursPanel";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import type { Schedule } from "@/data/types";

const DATES = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const TZ = "America/New_York";

let nextId = 1;
// An 8-hour shift on each of the given days of the week (0 = Sunday).
function shifts(employeeId: number, days: number[], hours = 8): Schedule[] {
  return days.map((d) => ({ id: nextId++, employeeId, date: DATES[d], startMinutes: 540, endMinutes: 540 + hours * 60 }));
}

function rowText(id: number): string {
  return screen.getByTestId(`hours-row-${id}`).textContent ?? "";
}

describe("DraftHoursPanel", () => {
  it("lists overtime first, then anyone under their minimum", () => {
    const employees = [
      { id: 1, name: "Alex Rivera", employment_type: "full_time" as const },  // 16 h: under 32
      { id: 2, name: "Sam Lee", employment_type: "part_time" as const },      // 24 h: fine
      { id: 3, name: "Jordan Kim", employment_type: "full_time" as const },   // 48 h: overtime
    ];
    const drafts = [...shifts(1, [1, 2]), ...shifts(2, [1, 2, 3]), ...shifts(3, [0, 1, 2, 3, 4, 5])];
    render(<DraftHoursPanel employees={employees} drafts={drafts} dates={DATES} rules={DEFAULT_SCHEDULING_RULES} timezone={TZ} />);

    const order = screen.getAllByTestId(/^hours-row-/).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["hours-row-3", "hours-row-1", "hours-row-2"]);
    expect(rowText(3)).toContain("▲ OT +8 h");
    expect(rowText(3)).toContain("48 h · 32–40 h");
    expect(rowText(1)).toContain("▼ Under min");
    expect(rowText(2)).toContain("24 h · 0–29 h");
    expect(screen.getByText("2 outside their range")).toBeInTheDocument();
    expect(within(screen.getByTestId("hours-row-3")).getByRole("img")).toHaveAccessibleName(
      "Jordan K.: 48 h scheduled; range 32 h to 40 h; 8 h overtime"
    );
  });

  it("flags hours over a personal maximum below the overtime line", () => {
    render(
      <DraftHoursPanel
        employees={[{ id: 1, name: "Alex Rivera", employment_type: "part_time", max_weekly_hours: 20 }]}
        drafts={shifts(1, [1, 2, 3])}
        dates={DATES}
        rules={DEFAULT_SCHEDULING_RULES}
        timezone={TZ}
      />
    );
    expect(rowText(1)).toContain("▲ Over max");
    expect(rowText(1)).not.toContain("OT");
  });

  it("marks anyone without an employment type", () => {
    render(
      <DraftHoursPanel employees={[{ id: 1, name: "Alex Rivera" }]} drafts={[]} dates={DATES} rules={DEFAULT_SCHEDULING_RULES} timezone={TZ} />
    );
    expect(screen.getByTitle("Employment type not set")).toBeInTheDocument();
    expect(screen.getByText("Everyone within their range")).toBeInTheDocument();
  });

  it("counts only this week's drafts", () => {
    render(
      <DraftHoursPanel
        employees={[{ id: 1, name: "Alex Rivera", employment_type: "part_time" }]}
        drafts={[...shifts(1, [1]), { id: 99, employeeId: 1, date: "2026-10-18", startMinutes: 540, endMinutes: 1020 }]}
        dates={DATES}
        rules={DEFAULT_SCHEDULING_RULES}
        timezone={TZ}
      />
    );
    expect(rowText(1)).toContain("8 h · 0–29 h");
  });

  it("shows eight people until expanded", () => {
    const employees = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, employment_type: "part_time" as const }));
    render(<DraftHoursPanel employees={employees} drafts={[]} dates={DATES} rules={DEFAULT_SCHEDULING_RULES} timezone={TZ} />);
    expect(screen.getAllByTestId(/^hours-row-/)).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Show all 10" }));
    expect(screen.getAllByTestId(/^hours-row-/)).toHaveLength(10);
  });

  it("renders nothing without employees", () => {
    const { container } = render(
      <DraftHoursPanel employees={[]} drafts={[]} dates={DATES} rules={DEFAULT_SCHEDULING_RULES} timezone={TZ} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
