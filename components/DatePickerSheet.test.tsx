import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatePickerSheet from "./DatePickerSheet";

const TODAY = new Date(2026, 4, 26); // May 26, 2026
const SELECTED = new Date(2026, 4, 26);

const baseProps = {
  open: true,
  selected: SELECTED,
  today: TODAY,
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

describe("DatePickerSheet", () => {
  it("displays the current month and year", () => {
    render(<DatePickerSheet {...baseProps} />);
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });

  it("renders all days of the month", () => {
    render(<DatePickerSheet {...baseProps} />);
    // May 2026 has 31 days
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("navigates to the previous month on prev-month click", async () => {
    render(<DatePickerSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByText("April 2026")).toBeInTheDocument();
  });

  it("navigates to the next month on next-month click", async () => {
    render(<DatePickerSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText("June 2026")).toBeInTheDocument();
  });

  it("wraps from January to December when navigating back", async () => {
    render(
      <DatePickerSheet
        {...baseProps}
        selected={new Date(2026, 0, 15)}
        today={new Date(2026, 0, 15)}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByText("December 2025")).toBeInTheDocument();
  });

  it("wraps from December to January when navigating forward", async () => {
    render(
      <DatePickerSheet
        {...baseProps}
        selected={new Date(2026, 11, 15)}
        today={new Date(2026, 11, 15)}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
  });

  it("calls onSelect and onClose when a day is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<DatePickerSheet {...baseProps} onSelect={onSelect} onClose={onClose} />);
    // Click day 15
    const buttons = screen.getAllByRole("button");
    const day15 = buttons.find(b => b.textContent === "15");
    await userEvent.click(day15!);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(<DatePickerSheet {...baseProps} onClose={onClose} />);
    const backdrop = container.children[0] as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the correct number of days for February in a leap year", async () => {
    render(
      <DatePickerSheet
        {...baseProps}
        selected={new Date(2024, 1, 1)}
        today={new Date(2024, 1, 1)}
      />
    );
    expect(screen.getByText("February 2024")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
  });

  it("shows the correct number of days for February in a non-leap year", async () => {
    render(
      <DatePickerSheet
        {...baseProps}
        selected={new Date(2026, 1, 1)}
        today={new Date(2026, 1, 1)}
      />
    );
    expect(screen.getByText("February 2026")).toBeInTheDocument();
    expect(screen.queryByText("29")).not.toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
  });

  it("syncs the view to the selected date when opened", () => {
    const { rerender } = render(
      <DatePickerSheet {...baseProps} open={false} selected={new Date(2026, 4, 1)} />
    );
    // Navigate to a different month
    // Then reopen with a new selected date
    rerender(
      <DatePickerSheet {...baseProps} open={true} selected={new Date(2026, 9, 1)} />
    );
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });
});
