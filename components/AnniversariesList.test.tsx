import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AnniversariesList, { type Anniversary } from "./AnniversariesList";

const items: Anniversary[] = [
  { employeeId: 2, employeeName: "Jordan K", date: "2026-06-17", daysUntil: 0, years: 6 },
  { employeeId: 1, employeeName: "Alex P", date: "2026-06-20", daysUntil: 3, years: 2 },
];

describe("AnniversariesList", () => {
  it("shows an empty state", () => {
    render(<AnniversariesList anniversaries={[]} />);
    expect(screen.getByText(/none coming up/i)).toBeInTheDocument();
  });

  it("labels today's anniversary as Today", () => {
    render(<AnniversariesList anniversaries={items} />);
    expect(within(screen.getByTestId("anniversary-2")).getByText("Today")).toBeInTheDocument();
  });

  it("shows the days-away and year count", () => {
    render(<AnniversariesList anniversaries={items} />);
    const row = screen.getByTestId("anniversary-1");
    expect(within(row).getByText("in 3 days")).toBeInTheDocument();
    expect(within(row).getByText("2 years")).toBeInTheDocument();
  });

  it("singularizes a one-year anniversary", () => {
    render(<AnniversariesList anniversaries={[{ employeeId: 5, employeeName: "New P", date: "2026-06-18", daysUntil: 1, years: 1 }]} />);
    const row = screen.getByTestId("anniversary-5");
    expect(within(row).getByText("1 year")).toBeInTheDocument();
    expect(within(row).getByText("Tomorrow")).toBeInTheDocument();
  });
});
