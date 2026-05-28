import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PrintableWeekGrid from "./PrintableWeekGrid";
import type { Employee, Schedule } from "../data/types";

const employees: Employee[] = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];

const weekDates = [
  "2026-05-25",
  "2026-05-26",
  "2026-05-27",
  "2026-05-28",
  "2026-05-29",
  "2026-05-30",
  "2026-05-31",
];

const schedules: Schedule[] = [
  { id: 1, employeeId: 1, date: "2026-05-25", startMinutes: 480, endMinutes: 960 },
  { id: 2, employeeId: 2, date: "2026-05-27", startMinutes: 600, endMinutes: 1080 },
];

const weekLabel = "May 25 – May 31, 2026";

describe("PrintableWeekGrid", () => {
  it("renders employee names", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("renders day headers for all 7 dates", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    // Check that some day labels are rendered (short weekday + m/d format)
    expect(screen.getByText(/Mon/)).toBeInTheDocument();
    expect(screen.getByText(/Tue/)).toBeInTheDocument();
  });

  it("renders the week label", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    expect(screen.getByText(weekLabel)).toBeInTheDocument();
  });

  it("renders the ShiftView header", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    expect(screen.getByRole("heading", { name: "ShiftView" })).toBeInTheDocument();
  });

  it("shows formatted shift times for a scheduled employee", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    // Alice is scheduled on 2026-05-25: 8:00 AM – 4:00 PM
    expect(screen.getByText("8:00 AM – 4:00 PM")).toBeInTheDocument();
  });

  it("shows formatted shift times for another scheduled employee", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    // Bob is scheduled on 2026-05-27: 10:00 AM – 6:00 PM
    expect(screen.getByText("10:00 AM – 6:00 PM")).toBeInTheDocument();
  });

  it("shows empty cell for off days", () => {
    const { container } = render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    // Count non-empty shift cells — only 2 schedules exist
    const cells = container.querySelectorAll("tbody td:not(:first-child)");
    const filledCells = Array.from(cells).filter(c => c.textContent && c.textContent.trim() !== "");
    expect(filledCells).toHaveLength(2);
  });

  it("has the hidden class (not visible in non-print)", () => {
    const { container } = render(
      <PrintableWeekGrid
        employees={employees}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("hidden");
  });

  it("renders correctly with no schedules", () => {
    render(
      <PrintableWeekGrid
        employees={employees}
        schedules={[]}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    const { container } = render(
      <PrintableWeekGrid
        employees={employees}
        schedules={[]}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    const cells = container.querySelectorAll("tbody td:not(:first-child)");
    const filledCells = Array.from(cells).filter(c => c.textContent && c.textContent.trim() !== "");
    expect(filledCells).toHaveLength(0);
  });

  it("renders correctly with no employees", () => {
    const { container } = render(
      <PrintableWeekGrid
        employees={[]}
        schedules={schedules}
        weekDates={weekDates}
        weekLabel={weekLabel}
      />
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(0);
  });
});
