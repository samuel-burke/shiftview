import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShiftCard from "./ShiftCard";
import type { Employee, Schedule } from "../data/types";

const employee: Employee = { id: 1, name: "Alice S." };

const scheduled: Schedule = {
  id: 1,
  employeeId: 1,
  date: "2026-05-23",
  startMinutes: 480, // 8am
  endMinutes: 960,   // 4pm
};

const STORE_HOURS = { open: 360, close: 1320 }; // 6am–10pm

describe("ShiftCard", () => {
  it("renders without crashing", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={600}
        isToday={true}
        onClick={() => {}}
      />
    );
  });

  it("displays employee name", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={600}
        isToday={true}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("Alice S.")).toBeInTheDocument();
  });

  it("displays shift time range", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={600}
        isToday={false}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/8:00 AM/)).toBeInTheDocument();
    expect(screen.getByText(/4:00 PM/)).toBeInTheDocument();
  });

  it("shows 'Here' badge when employee is currently on shift", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={600} // 10am — within 8am–4pm
        isToday={true}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("Here")).toBeInTheDocument();
  });

  it("does not show 'Here' badge outside shift hours", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={360} // 6am — before shift starts
        isToday={true}
        onClick={() => {}}
      />
    );
    expect(screen.queryByText("Here")).not.toBeInTheDocument();
  });

  it("shows arrival countdown when shift hasn't started yet today", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled} // starts at 8am (480)
        storeHours={STORE_HOURS}
        nowMinutes={420}     // 7am — 60 min before
        isToday={true}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("In 1h")).toBeInTheDocument();
  });

  it("calls onClick when the card is clicked", async () => {
    const onClick = vi.fn();
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled}
        storeHours={STORE_HOURS}
        nowMinutes={600}
        isToday={true}
        onClick={onClick}
      />
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("displays shift type label", () => {
    render(
      <ShiftCard
        employee={employee}
        schedule={scheduled} // 8am–4pm = mid
        storeHours={STORE_HOURS}
        nowMinutes={600}
        isToday={true}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("mid")).toBeInTheDocument();
  });
});
