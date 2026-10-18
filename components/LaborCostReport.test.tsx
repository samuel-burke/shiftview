import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LaborCostReport, { toLaborCostReportData } from "./LaborCostReport";

const BODY = {
  weekStart: "2026-07-06",
  totalCost: 1070,
  employeesMissingRate: 0,
  employees: [
    { employeeId: 1, employeeName: "Alex P", totalHours: 45, overtimeMinutes: 300, payRate: 20, cost: 950 },
    { employeeId: 2, employeeName: "Jordan K", totalHours: 8, overtimeMinutes: 0, payRate: 15, cost: 120 },
  ],
  days: [
    { date: "2026-07-06", scheduledCost: 300, actualCost: 310.5 },
    { date: "2026-07-07", scheduledCost: 180, actualCost: 0 },
  ],
  actual: {
    totalCost: 310.5,
    employeesMissingRate: 1,
    hasIncomplete: true,
    employees: [
      { employeeId: 1, employeeName: "Alex P", totalHours: 9.5, overtimeHours: 0, doubleTimeHours: 0, cost: 190 },
      { employeeId: 3, employeeName: "Sam B", totalHours: 8, overtimeHours: 1, doubleTimeHours: 0, cost: null },
    ],
  },
};

describe("toLaborCostReportData", () => {
  it("joins scheduled and actual rows by employee", () => {
    const data = toLaborCostReportData(BODY)!;
    expect(data.scheduledTotal).toBe(1070);
    expect(data.actualTotal).toBe(310.5);
    expect(data.employees.find((e) => e.employeeId === 1)).toMatchObject({ scheduledCost: 950, actualCost: 190, actualHours: 9.5 });
    expect(data.employees.find((e) => e.employeeId === 3)).toMatchObject({ scheduledCost: null, actualCost: null, actualHours: 8, overtimeHours: 1 });
  });

  it("rejects what isn't a labor-cost body (an error, or the e2e mock's [])", () => {
    expect(toLaborCostReportData(null)).toBeNull();
    expect(toLaborCostReportData([])).toBeNull();
    expect(toLaborCostReportData({ error: "x" })).toBeNull();
  });

  it("reads a body from before actual cost existed", () => {
    const { actual: _a, ...old } = BODY;
    void _a;
    expect(toLaborCostReportData(old)!.actualTotal).toBe(0);
  });
});

describe("LaborCostReport", () => {
  it("shows scheduled and actual cost per day and for the week", () => {
    render(<LaborCostReport data={toLaborCostReportData(BODY)!} />);
    expect(screen.getByTestId("labor-cost-scheduled-total")).toHaveTextContent("$1,070.00");
    expect(screen.getByTestId("labor-cost-actual-total")).toHaveTextContent("$310.50");
    const mon = screen.getByTestId("labor-cost-day-2026-07-06");
    expect(within(mon).getByText("$300.00")).toBeInTheDocument();
    expect(within(mon).getByText("$310.50")).toBeInTheDocument();
    expect(within(screen.getByTestId("labor-cost-day-2026-07-07")).getByText("$180.00")).toBeInTheDocument();
  });

  it("flags missing rates and unpaired punches", () => {
    render(<LaborCostReport data={toLaborCostReportData(BODY)!} />);
    expect(screen.getByText(/1 employee has hours with no pay rate set/)).toBeInTheDocument();
    expect(screen.getByText(/punches don.t pair up/)).toBeInTheDocument();
    expect(within(screen.getByTestId("labor-cost-employee-3")).getByText("No rate")).toBeInTheDocument();
  });

  it("shows each employee's scheduled and actual cost", () => {
    render(<LaborCostReport data={toLaborCostReportData(BODY)!} />);
    const alex = screen.getByTestId("labor-cost-employee-1");
    expect(within(alex).getByText("$950.00")).toBeInTheDocument();
    expect(within(alex).getByText("$190.00")).toBeInTheDocument();
  });
});
