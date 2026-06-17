import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SplhCard from "./SplhCard";

describe("SplhCard", () => {
  it("shows the SPLH value and the sales/labor breakdown", () => {
    render(<SplhCard salesCents={100000} laborMinutes={2400} splhCents={2500} />);
    expect(screen.getByTestId("splh-value")).toHaveTextContent("$25.00/hr");
    expect(screen.getByText(/\$1,000.00 sales · 40h labor/)).toBeInTheDocument();
  });

  it("shows a dash when SPLH is undefined (no labor)", () => {
    render(<SplhCard salesCents={50000} laborMinutes={0} splhCents={null} />);
    expect(screen.getByTestId("splh-value")).toHaveTextContent("—");
  });
});
