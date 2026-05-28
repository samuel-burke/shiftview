import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FillDaySheet from "./FillDaySheet";

const EMPLOYEES = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Carol" },
];

function makeProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    employees: EMPLOYEES,
    scheduledEmployeeIds: new Set<number>(),
    defaultStart: 480,
    defaultEnd: 960,
    dateLabel: "Mon, Jun 1",
    onSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("FillDaySheet", () => {
  it("renders all employee names", () => {
    render(<FillDaySheet {...makeProps()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("already-scheduled employees show 'Already scheduled'", () => {
    const props = makeProps({ scheduledEmployeeIds: new Set([1]) });
    render(<FillDaySheet {...props} />);
    expect(screen.getByText("Already scheduled")).toBeInTheDocument();
  });

  it("unscheduled employees are checked by default", () => {
    render(<FillDaySheet {...makeProps()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // All 3 should be checked by default (unscheduled)
    checkboxes.forEach((cb) => expect(cb).toBeChecked());
  });

  it("toggle unchecks an employee", () => {
    render(<FillDaySheet {...makeProps()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it("submit calls onSubmit with correct args", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<FillDaySheet {...makeProps({ onSubmit, onClose })} />);
    // Click submit button
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [ids, start, end] = onSubmit.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(start).toBe(480);
    expect(end).toBe(960);
  });

  it("disables submit button when no employees selected", () => {
    render(<FillDaySheet {...makeProps()} />);
    // Uncheck all
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }
    const btn = screen.getByRole("button", { name: /Schedule/i });
    expect(btn).toBeDisabled();
  });
});
