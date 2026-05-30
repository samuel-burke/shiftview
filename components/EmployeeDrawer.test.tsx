import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeDrawer from "./EmployeeDrawer";
import type { Employee, Schedule } from "../data/types";

const employee: Employee = { id: 1, name: "Alice Smith" };

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

  it("renders Edit Shift button for managers", () => {
    render(<EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />);
    expect(screen.getByText("Edit Shift")).toBeInTheDocument();
  });

  // ── Mark as Off confirmation ───────────────────────────────────────────────

  it("shows confirmation dialog when Mark as Off is clicked", async () => {
    render(<EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Shift" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as Off" }));
    expect(screen.getByText(/remove alice smith from schedule/i)).toBeInTheDocument();
  });

  it("does not call onMarkOff when Cancel is clicked in confirmation", async () => {
    const onMarkOff = vi.fn().mockResolvedValue(undefined);
    render(<EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} onMarkOff={onMarkOff} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Shift" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as Off" }));
    const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
    await userEvent.click(cancelBtns[cancelBtns.length - 1]);
    expect(onMarkOff).not.toHaveBeenCalled();
    expect(screen.queryByText(/remove alice smith from schedule/i)).not.toBeInTheDocument();
  });

  it("calls onMarkOff when confirmed in dialog", async () => {
    const onMarkOff = vi.fn().mockResolvedValue(undefined);
    render(<EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} onMarkOff={onMarkOff} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Shift" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as Off" }));
    const markOffBtns = screen.getAllByRole("button", { name: "Mark as Off" });
    await userEvent.click(markOffBtns[markOffBtns.length - 1]);
    expect(onMarkOff).toHaveBeenCalledWith(schedule.id);
  });

  // ── Message button ─────────────────────────────────────────────────────────

  it("shows a mailto Message link when employee has an email", () => {
    const empWithEmail = { ...employee, email: "alice@example.com" };
    render(<EmployeeDrawer {...baseProps} employee={empWithEmail} schedule={schedule} />);
    const link = screen.getByRole("link", { name: "Message" });
    expect(link).toHaveAttribute("href", "mailto:alice@example.com");
  });

  it("hides the Message link when employee has no email", () => {
    render(<EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />);
    expect(screen.queryByRole("link", { name: "Message" })).not.toBeInTheDocument();
  });
});
