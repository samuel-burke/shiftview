import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PtoBalanceCard from "./PtoBalanceCard";
import { computePtoBalance } from "../lib/pto-balance";

describe("PtoBalanceCard", () => {
  it("shows remaining, used, and allowance when tracked", () => {
    render(<PtoBalanceCard balance={computePtoBalance(15, ["2026-02-01", "2026-03-01"], 2026)} year={2026} />);
    expect(screen.getByTestId("pto-remaining")).toHaveTextContent("13 days");
    expect(screen.getByText(/2 days used/i)).toBeInTheDocument();
    expect(screen.getByText(/of 15 days/i)).toBeInTheDocument();
  });

  it("singularizes a one-day remaining", () => {
    render(<PtoBalanceCard balance={computePtoBalance(3, ["2026-01-01", "2026-01-02"], 2026)} year={2026} />);
    expect(screen.getByTestId("pto-remaining")).toHaveTextContent("1 day");
  });

  it("shows an untracked state when there's no allowance", () => {
    render(<PtoBalanceCard balance={computePtoBalance(null, ["2026-02-01"], 2026)} year={2026} />);
    expect(screen.getByTestId("pto-untracked")).toBeInTheDocument();
    expect(screen.getByText(/isn’t tracked/i)).toBeInTheDocument();
  });

  it("flags a negative (over-used) balance", () => {
    render(<PtoBalanceCard balance={computePtoBalance(1, ["2026-01-01", "2026-01-02"], 2026)} year={2026} />);
    const remaining = screen.getByTestId("pto-remaining");
    expect(remaining).toHaveTextContent("-1 day");
    expect(remaining.className).toMatch(/red/);
  });

  it("includes the employee name when provided", () => {
    render(
      <PtoBalanceCard balance={computePtoBalance(10, [], 2026)} year={2026} employeeName="Alex P" />
    );
    expect(screen.getByText(/Alex P/)).toBeInTheDocument();
  });
});
