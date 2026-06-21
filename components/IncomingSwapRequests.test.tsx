import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IncomingSwapRequests, { type IncomingSwap } from "./IncomingSwapRequests";

const SWAPS: IncomingSwap[] = [
  { id: 7, requesterName: "Alex Kim", date: "2026-06-22", scheduleATime: "9:00 AM – 5:00 PM", scheduleBTime: "12:00 PM – 8:00 PM" },
];

const BASE = {
  swaps: SWAPS,
  respondingId: null as number | null,
  onAccept: () => {},
  onDecline: () => {},
};

describe("IncomingSwapRequests", () => {
  it("renders nothing when there are no incoming swaps", () => {
    const { container } = render(<IncomingSwapRequests {...BASE} swaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the requester and both shift sides", () => {
    render(<IncomingSwapRequests {...BASE} />);
    expect(screen.getByText(/Alex Kim wants to swap/i)).toBeInTheDocument();
    expect(screen.getByText(/You take: 9:00 AM – 5:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/You give: 12:00 PM – 8:00 PM/)).toBeInTheDocument();
  });

  it("calls onAccept / onDecline with the swap id", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<IncomingSwapRequests {...BASE} onAccept={onAccept} onDecline={onDecline} />);
    fireEvent.click(screen.getByLabelText(/Accept swap with Alex Kim/i));
    fireEvent.click(screen.getByLabelText(/Decline swap with Alex Kim/i));
    expect(onAccept).toHaveBeenCalledWith(7);
    expect(onDecline).toHaveBeenCalledWith(7);
  });

  it("disables the buttons for the swap currently being responded to", () => {
    const onAccept = vi.fn();
    render(<IncomingSwapRequests {...BASE} respondingId={7} onAccept={onAccept} />);
    fireEvent.click(screen.getByLabelText(/Accept swap with Alex Kim/i));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
