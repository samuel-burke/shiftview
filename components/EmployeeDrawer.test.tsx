import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeDrawer from "./EmployeeDrawer";
import type { Employee, Schedule, AvailabilityRecord } from "../data/types";

// MessageThread (imported by EmployeeDrawer) uses supabase-browser
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "manager-123" } },
        error: null,
      }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    }),
    removeChannel: vi.fn(),
  }),
}));

afterEach(() => vi.restoreAllMocks());

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

  it("opens in view mode when schedule is null, showing Add Shift and Message", () => {
    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={null} />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Add Shift")).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.queryByText("Save Shift")).not.toBeInTheDocument();
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

  it("opens message thread when Message button is clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    render(
      <EmployeeDrawer {...baseProps} employee={employee} schedule={schedule} />
    );
    await userEvent.click(screen.getByText("Message"));

    // MessageThread drawer opens with the employee name as placeholder
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Message Alice Smith…")).toBeInTheDocument();
    });
  });

  it("hides Message button when employee has no user_id", () => {
    const employeeNoAccount: Employee = { id: 2, name: "Bob Jones" };
    render(
      <EmployeeDrawer {...baseProps} employee={employeeNoAccount} schedule={schedule} />
    );
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
  });

  // ── Availability record tests ──────────────────────────────────────────────

  it("shows full-day unavailability banner 'Usually unavailable on...' when record has null times", () => {
    // date = "2026-05-25" is a Monday (day 1)
    const records: AvailabilityRecord[] = [
      { id: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: null },
    ];
    render(
      <EmployeeDrawer
        {...baseProps}
        employee={employee}
        schedule={schedule}
        date="2026-05-25"
        availabilityRecords={records}
      />
    );
    expect(screen.getByText(/Usually unavailable on Monday/)).toBeInTheDocument();
  });

  it("shows windowed availability banner 'Available X – Y only' when record has times", () => {
    // date = "2026-05-25" is a Monday (day 1)
    const records: AvailabilityRecord[] = [
      { id: 2, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320, note: null },
    ];
    render(
      <EmployeeDrawer
        {...baseProps}
        employee={employee}
        schedule={schedule}
        date="2026-05-25"
        availabilityRecords={records}
      />
    );
    // fmtMinutes(720) = "12:00 PM", fmtMinutes(1320) = "10:00 PM"
    expect(screen.getByText(/Available Monday 12:00 PM – 10:00 PM only/)).toBeInTheDocument();
  });

  it("shows no banner when no matching availability record", () => {
    const records: AvailabilityRecord[] = [
      { id: 1, dayOfWeek: 3, startMinutes: null, endMinutes: null, note: null }, // Wednesday, not Monday
    ];
    render(
      <EmployeeDrawer
        {...baseProps}
        employee={employee}
        schedule={schedule}
        date="2026-05-25" // Monday
        availabilityRecords={records}
      />
    );
    expect(screen.queryByText(/Usually unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Available .* only/)).not.toBeInTheDocument();
  });

  // ── Conflict UI tests ──────────────────────────────────────────────────────

  it("shows conflict banner when onSave throws with conflict", async () => {
    const conflictError = Object.assign(
      new Error("Shift falls outside availability window (12:00 PM – 10:00 PM)"),
      { conflict: "availability", window: { startMinutes: 720, endMinutes: 1320 } }
    );
    const onSave = vi.fn().mockRejectedValue(conflictError);

    render(
      <EmployeeDrawer
        {...baseProps}
        employee={employee}
        schedule={schedule}
        onSave={onSave}
      />
    );

    // Enter edit mode
    await userEvent.click(screen.getByText("Edit Shift"));
    // Submit the form
    await userEvent.click(screen.getByText("Save Shift"));

    await waitFor(() => {
      expect(screen.getByText(/Availability Conflict/)).toBeInTheDocument();
    });
  });

  it("Override button calls onSave with override=true", async () => {
    const conflictError = Object.assign(
      new Error("Shift outside availability window"),
      { conflict: "availability", window: null }
    );
    const onSave = vi.fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce(undefined);

    render(
      <EmployeeDrawer
        {...baseProps}
        employee={employee}
        schedule={schedule}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByText("Edit Shift"));
    await userEvent.click(screen.getByText("Save Shift"));

    await waitFor(() => {
      expect(screen.getByText("Override & Save")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Override & Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave).toHaveBeenNthCalledWith(2, schedule.id, 480, 960, true);
    });
  });
});
