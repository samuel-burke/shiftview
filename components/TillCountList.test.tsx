import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TillCountList, { type TillCount } from "./TillCountList";

const counts: TillCount[] = [
  { id: 1, counterName: "Alex", type: "open", expectedCents: 20000, countedCents: 20000, varianceCents: 0, status: "balanced" },
  { id: 2, counterName: "Jordan", type: "close", expectedCents: 50000, countedCents: 49850, varianceCents: -150, status: "short" },
];

describe("TillCountList", () => {
  it("shows an empty state", () => {
    render(<TillCountList counts={[]} />);
    expect(screen.getByText(/no drawer counts today/i)).toBeInTheDocument();
  });

  it("renders each count with type, counter, and status", () => {
    render(<TillCountList counts={counts} />);
    expect(within(screen.getByTestId("till-count-1")).getByText(/open · Alex/)).toBeInTheDocument();
    expect(within(screen.getByTestId("till-count-1")).getByText("balanced")).toBeInTheDocument();
    expect(within(screen.getByTestId("till-count-2")).getByText("short")).toBeInTheDocument();
  });

  it("formats a negative variance as money", () => {
    render(<TillCountList counts={counts} />);
    expect(within(screen.getByTestId("till-count-2")).getByText("-$1.50")).toBeInTheDocument();
  });
});
