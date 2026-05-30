import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeDrawer from "./EmployeeDrawer";
import type { Employee, Schedule } from "../data/types";

const employee: Employee = { id: 1, name: "Alice Smith", user_id: "user-abc-123" };

const schedule: Schedule = {
  id: 1,
  employeeId: 1,
  date: "2026-05-23",
  startMinutes: 480, // 8am
  endMinutes: 960,   // 4pm
};

const baseProps = {
  open: true as const,
  storeHours: { open: 360, close: 1320 },
  nowMinutes: 600,
  isToday: true as const,
  onClose: vi.fn(),
  onSave: vi.fn().mockResolvedValue(undefined),
  onCreate: vi.fn().mockResolvedValue(undefined),
  onMarkOff: vi.fn().mockResolvedValue(undefined),
  isManager: true,
};

describe("EmployeeDrawer", () => {
  it("renders nothing when employee is null", () => {
    const { container } = render(
      <EmployeeDrawer {...baseProps} employee={null} schedule={schedule} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens in edit mode when schedule is null", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={null} />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Save Shift")).toBeInTheDocument();
  });

  it("renders employee name when open", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows shift start and end times", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    expect(screen.getByText("8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("4:00 PM")).toBeInTheDocument();
  });

  it("shows shift type", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    expect(screen.getByText("Mid")).toBeInTheDocument();
  });

  it("shows 'Here' status when employee is currently on shift today", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} nowMinutes={600} />
    );
    expect(screen.getAllByText("Here").length).toBeGreaterThan(0);
  });

  it("shows 'Scheduled' status on non-today days even when nowMinutes is within shift", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} isToday={false} />
    );
    expect(screen.queryByText("Here")).not.toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} onClose={onClose} />
    );
    await userEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} onClose={onClose} />
    );
    const backdrop = container.children[0] as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders Edit Shift and Message action buttons", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    expect(screen.getByText("Edit Shift")).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
  });

  it("shows compose area when Message button is clicked", async () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    await userEvent.click(screen.getByText("Message"));
    expect(screen.getByPlaceholderText("Write a message…")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("hides Message button when employee has no user_id", () => {
    const employeeNoAccount: Employee = { id: 2, name: "Bob Jones" };
    render(
      <EmployeeDrawer {...baseProps} employee={employeeNoAccount} schedule={schedule} />
    );
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
  });
});
