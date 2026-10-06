import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeekGrid from "./WeekGrid";
import { addDaysToKey } from "@/lib/dates";

const START = "2026-10-04"; // a Sunday
const DATES = Array.from({ length: 7 }, (_, i) => addDaysToKey(START, i));
const HOURS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }]));
const EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];
const SCHEDULES = [
  { id: 10, employeeId: 1, date: "2026-10-05", startMinutes: 360, endMinutes: 840 },  // Mon opener, 8h
  { id: 11, employeeId: 1, date: "2026-10-06", startMinutes: 780, endMinutes: 1320 }, // Tue closer, 9h
  { id: 12, employeeId: 2, date: "2026-10-05", startMinutes: 540, endMinutes: 1020 }, // Mon mid, 8h
];

function renderGrid(props: Partial<React.ComponentProps<typeof WeekGrid>> = {}) {
  const onSelect = vi.fn();
  render(
    <WeekGrid
      employees={EMPLOYEES}
      schedules={SCHEDULES}
      dates={DATES}
      weeklyHours={HOURS}
      todayKey="2026-10-05"
      onSelect={onSelect}
      {...props}
    />
  );
  return { onSelect };
}

describe("WeekGrid", () => {
  it("shows one row per person with their weekly hours", () => {
    renderGrid();
    const alice = screen.getByRole("rowheader", { name: /Alice S\./ });
    expect(within(alice).getByText("17 hrs")).toBeInTheDocument();
    const bob = screen.getByRole("rowheader", { name: /Bob J\./ });
    expect(within(bob).getByText("8 hrs")).toBeInTheDocument();
  });

  it("labels each shift cell with the person, day, type and time", () => {
    renderGrid();
    expect(screen.getByRole("button", { name: "Alice Smith, Monday, October 5: Opener 6a to 2p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alice Smith, Tuesday, October 6: Closer 1p to 10p" })).toBeInTheDocument();
  });

  it("marks today's column", () => {
    renderGrid();
    const headers = screen.getAllByRole("columnheader");
    const today = headers.find((h) => h.getAttribute("aria-current") === "date");
    expect(today).toHaveTextContent("Oct 5");
  });

  it("passes the shift, or null for an empty day, to onSelect", async () => {
    const { onSelect } = renderGrid();
    await userEvent.click(screen.getByRole("button", { name: /Bob Jones, Monday, October 5: Mid/ }));
    expect(onSelect).toHaveBeenCalledWith(EMPLOYEES[1], "2026-10-05", SCHEDULES[2]);

    await userEvent.click(screen.getByRole("button", { name: /Bob Jones, Tuesday, October 6: off/ }));
    expect(onSelect).toHaveBeenLastCalledWith(EMPLOYEES[1], "2026-10-06", null);
  });

  it("totals hours and people per day", () => {
    renderGrid();
    const footer = screen.getAllByRole("rowgroup")[2];
    expect(within(footer).getByText("25 hrs")).toBeInTheDocument(); // the week
    expect(within(footer).getByText("16h")).toBeInTheDocument();    // Monday
    expect(within(footer).getByText("2 people")).toBeInTheDocument();
  });

  it("flags requested time off and the selected cell", () => {
    renderGrid({
      timeOff: [{ id: 1, employeeId: 2, date: "2026-10-07", status: "pending" }],
      selected: { employeeId: 1, date: "2026-10-05" },
    });
    expect(screen.getByRole("button", { name: /Bob Jones, Wednesday, October 7: off, time off requested/ })).toHaveTextContent("Time off requested");
    expect(screen.getByRole("button", { name: /Alice Smith, Monday, October 5/ })).toHaveAttribute("aria-pressed", "true");
  });
});
