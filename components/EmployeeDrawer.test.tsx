import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeDrawer from "./EmployeeDrawer";
import type { Employee, Schedule } from "../data/types";

const employee: Employee = { id: 1, name: "Alice Smith", avatar: "AS" };

const schedule: Schedule = {
  id: 1,
  employeeId: 1,
  date: "2026-05-23",
  startMinutes: 480, // 8am
  endMinutes: 960,   // 4pm
};

describe("EmployeeDrawer", () => {
  it("renders nothing when employee is null", () => {
    const { container } = render(
      <EmployeeDrawer
        open={true}
        employee={null}
        schedule={schedule}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when schedule is null", () => {
    const { container } = render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={null}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders employee name when open", () => {
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows shift start and end times", () => {
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getByText("8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("4:00 PM")).toBeInTheDocument();
  });

  it("shows shift type", () => {
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule} // 8am = opener
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getByText("Opener")).toBeInTheDocument();
  });

  it("shows 'Here' status when employee is currently on shift", () => {
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600} // 10am — within 8am–4pm
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getAllByText("Here").length).toBeGreaterThan(0);
  });

  it("shows 'Off Today' status for off-day schedule", () => {
    const offSchedule: Schedule = { ...schedule, startMinutes: -1, endMinutes: -1 };
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={offSchedule}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getByText("Off Today")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600}
        onClose={onClose}
      />
    );
    // Fragment renders two siblings: backdrop div then panel div
    const backdrop = container.children[0] as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders Edit Shift and Message action buttons", () => {
    render(
      <EmployeeDrawer
        open={true}
        employee={employee}
        schedule={schedule}
        nowMinutes={600}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        isManager={true}
      />
    );
    expect(screen.getByText("Edit Shift")).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
  });
});
