import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TeamSection from "./TeamSection";
import type { Employee, Schedule } from "../data/types";

const employees: Employee[] = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];

const schedules: Schedule[] = [
  { id: 1, employeeId: 1, date: "2026-05-23", startMinutes: 480, endMinutes: 960 },
  { id: 2, employeeId: 2, date: "2026-05-23", startMinutes: 720, endMinutes: 1200 },
];

describe("TeamSection", () => {
  it("returns null when schedules array is empty", () => {
    const { container } = render(
      <TeamSection
        label="On Shift"
        count={0}
        schedules={[]}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the section label", () => {
    render(
      <TeamSection
        label="On Shift"
        count={2}
        schedules={schedules}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("On Shift")).toBeInTheDocument();
  });

  it("shows count badge", () => {
    render(
      <TeamSection
        label="On Shift"
        count={2}
        schedules={schedules}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders a ShiftCard for each schedule", () => {
    render(
      <TeamSection
        label="On Shift"
        count={2}
        schedules={schedules}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("sorts schedules by startMinutes ascending", () => {
    const unsorted: Schedule[] = [
      { id: 2, employeeId: 2, date: "2026-05-23", startMinutes: 720, endMinutes: 1200 },
      { id: 1, employeeId: 1, date: "2026-05-23", startMinutes: 480, endMinutes: 960 },
    ];
    render(
      <TeamSection
        label="On Shift"
        count={2}
        schedules={unsorted}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    const aliceIndex = names.findIndex((t) => t?.includes("Alice Smith"));
    const bobIndex = names.findIndex((t) => t?.includes("Bob Jones"));
    expect(aliceIndex).toBeLessThan(bobIndex);
  });

  it("puts off-day schedules last", () => {
    const mixed: Schedule[] = [
      { id: 3, employeeId: 2, date: "2026-05-23", startMinutes: -1, endMinutes: -1 },
      { id: 1, employeeId: 1, date: "2026-05-23", startMinutes: 480, endMinutes: 960 },
    ];
    render(
      <TeamSection
        label="All"
        count={2}
        schedules={mixed}
        employees={employees}
        nowMinutes={600}
        isToday={true}
        onSelect={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toContain("Alice Smith");
    expect(buttons[1].textContent).toContain("Bob Jones");
  });
});
