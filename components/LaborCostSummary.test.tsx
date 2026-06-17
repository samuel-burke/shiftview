import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LaborCostSummary, { type LaborCostRow } from "./LaborCostSummary";

const rows: LaborCostRow[] = [
  { employeeId: 1, employeeName: "Alex P", totalHours: 45, overtimeMinutes: 300, payRate: 20, cost: 950 },
  { employeeId: 2, employeeName: "Jordan K", totalHours: 8, overtimeMinutes: 0, payRate: 15, cost: 120 },
];

describe("LaborCostSummary", () => {
  it("shows the week total formatted as currency", () => {
    render(<LaborCostSummary employees={rows} totalCost={1070} />);
    expect(screen.getByTestId("labor-cost-total")).toHaveTextContent("$1,070.00");
  });

  it("shows each employee's cost", () => {
    render(<LaborCostSummary employees={rows} totalCost={1070} />);
    expect(within(screen.getByTestId("labor-cost-row-1")).getByText("$950.00")).toBeInTheDocument();
    expect(within(screen.getByTestId("labor-cost-row-2")).getByText("$120.00")).toBeInTheDocument();
  });

  it("flags an overtime portion", () => {
    render(<LaborCostSummary employees={rows} totalCost={1070} />);
    expect(within(screen.getByTestId("labor-cost-row-1")).getByText(/5h OT/)).toBeInTheDocument();
  });

  it("prompts to set a rate when cost is unknown", () => {
    render(
      <LaborCostSummary
        employees={[{ employeeId: 3, employeeName: "Sam B", totalHours: 8, overtimeMinutes: 0, payRate: null, cost: null }]}
        totalCost={0}
        employeesMissingRate={1}
      />
    );
    expect(screen.getByText("Set rate")).toBeInTheDocument();
    expect(screen.getByText(/1 employee has no pay rate set/i)).toBeInTheDocument();
  });

  it("shows an empty state when no one is scheduled", () => {
    render(<LaborCostSummary employees={[]} totalCost={0} />);
    expect(screen.getByText(/no one scheduled/i)).toBeInTheDocument();
  });
});
