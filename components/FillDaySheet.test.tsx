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

  it("submit calls onSubmit once per selected employee with correct args (Promise.allSettled)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<FillDaySheet {...makeProps({ onSubmit, onClose })} />);
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    // onSubmit is called once per employee (3 employees)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    // Each call gets a single-element array, and correct start/end
    onSubmit.mock.calls.forEach(([ids, start, end]) => {
      expect(ids).toHaveLength(1);
      expect([1, 2, 3]).toContain(ids[0]);
      expect(start).toBe(480);
      expect(end).toBe(960);
    });
    // onClose is called after all succeed
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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

  it("shows per-employee error and does not close on partial failure (Promise.allSettled)", async () => {
    // onSubmit resolves for id 1 and 3, rejects for id 2
    const onSubmit = vi.fn().mockImplementation(([id]) => {
      if (id === 2) return Promise.reject(new Error("Server error"));
      return Promise.resolve();
    });
    const onClose = vi.fn();
    render(<FillDaySheet {...makeProps({ onSubmit, onClose })} />);
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    // Should NOT close because there was a failure
    expect(onClose).not.toHaveBeenCalled();
    // Should show a per-employee error next to Bob
    await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
    // Should also show a summary error message
    expect(screen.getByText(/some employees could not be scheduled/i)).toBeInTheDocument();
  });

  it("shows error and blocks submit when start >= end", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <FillDaySheet
        {...makeProps({ onSubmit, onClose, defaultStart: 960, defaultEnd: 480 })}
      />
    );
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText("Start time must be before end time")).toBeInTheDocument()
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows error and blocks submit when start equals end", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FillDaySheet
        {...makeProps({ onSubmit, defaultStart: 480, defaultEnd: 480 })}
      />
    );
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText("Start time must be before end time")).toBeInTheDocument()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not close sheet when submitting and close button is clicked", async () => {
    // Make all onSubmit calls hang until we resolve them together
    const resolvers: Array<() => void> = [];
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>(res => { resolvers.push(res); })
    );
    const onClose = vi.fn();
    render(<FillDaySheet {...makeProps({ onSubmit, onClose })} />);

    // Start submit
    const btn = screen.getByRole("button", { name: /Schedule/i });
    fireEvent.click(btn);
    // Wait until all 3 per-employee onSubmit calls have been made
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));

    // Try clicking the close (✕) button while submitting — should be blocked
    const closeBtn = screen.getByRole("button", { name: "✕" });
    fireEvent.click(closeBtn);
    expect(onClose).not.toHaveBeenCalled();

    // Resolve all pending submissions
    resolvers.forEach(res => res());
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
