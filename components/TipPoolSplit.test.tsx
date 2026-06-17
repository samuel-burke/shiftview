import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TipPoolSplit, { type TipShareView } from "./TipPoolSplit";

const shares: TipShareView[] = [
  { employeeId: 1, employeeName: "Alex P", minutes: 360, cents: 6000 },
  { employeeId: 2, employeeName: "Jordan K", minutes: 120, cents: 2000 },
];

describe("TipPoolSplit", () => {
  it("shows the pool total", () => {
    render(<TipPoolSplit poolCents={8000} shares={shares} />);
    expect(screen.getByTestId("tip-pool-total")).toHaveTextContent("$80.00");
  });

  it("shows each person's hours and share", () => {
    render(<TipPoolSplit poolCents={8000} shares={shares} />);
    const row = screen.getByTestId("tip-share-1");
    expect(within(row).getByText("Alex P")).toBeInTheDocument();
    expect(within(row).getByText("6h")).toBeInTheDocument();
    expect(within(row).getByText("$60.00")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<TipPoolSplit poolCents={8000} shares={[]} />);
    expect(screen.getByText(/no one scheduled to split tips/i)).toBeInTheDocument();
  });
});
