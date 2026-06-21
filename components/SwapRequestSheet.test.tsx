import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SwapRequestSheet, { type CoworkerShift } from "./SwapRequestSheet";

const COWORKERS: CoworkerShift[] = [
  { scheduleId: 20, employeeName: "Jordan Lee", startMinutes: 540, endMinutes: 1020 },
  { scheduleId: 21, employeeName: "Sam Rivera", startMinutes: 600, endMinutes: 1080 },
];

const BASE = {
  open: true,
  onClose: () => {},
  dateLabel: "Monday, Jun 22",
  myShiftTime: "9:00 AM – 5:00 PM",
  coworkers: COWORKERS,
  loading: false,
  error: null,
  submitting: false,
  submitError: null,
  onSelect: () => {},
};

describe("SwapRequestSheet", () => {
  it("renders nothing when closed", () => {
    render(<SwapRequestSheet {...BASE} open={false} />);
    expect(screen.queryByTestId("swap-request-sheet")).toBeNull();
  });

  it("lists each coworker shift when open", () => {
    render(<SwapRequestSheet {...BASE} />);
    expect(screen.getByTestId("swap-request-sheet")).toBeInTheDocument();
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
  });

  it("calls onSelect with the chosen schedule id", () => {
    const onSelect = vi.fn();
    render(<SwapRequestSheet {...BASE} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Jordan Lee"));
    expect(onSelect).toHaveBeenCalledWith(20);
  });

  it("shows an empty state when there are no coworkers", () => {
    render(<SwapRequestSheet {...BASE} coworkers={[]} />);
    expect(screen.getByText(/No coworkers are scheduled/i)).toBeInTheDocument();
  });

  it("surfaces a load error", () => {
    render(<SwapRequestSheet {...BASE} coworkers={[]} error="Couldn't load coworker shifts. Please try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load coworker shifts");
  });

  it("surfaces a submit error", () => {
    render(<SwapRequestSheet {...BASE} submitError="You can only request swaps for your own shifts" />);
    expect(screen.getByRole("alert")).toHaveTextContent("your own shifts");
  });

  it("disables coworker buttons while submitting", () => {
    const onSelect = vi.fn();
    render(<SwapRequestSheet {...BASE} submitting onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Jordan Lee"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
