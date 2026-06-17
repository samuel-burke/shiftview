import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MinorComplianceList, { type MinorViolation } from "./MinorComplianceList";

const violations: MinorViolation[] = [
  {
    scheduleId: 1, employeeId: 1, employeeName: "Teen A", age: 16,
    startMinutes: 900, endMinutes: 1380, issues: ["Ends after 10:00 PM", "Exceeds 8h/day"],
  },
];

describe("MinorComplianceList", () => {
  it("shows a clear state with no violations", () => {
    render(<MinorComplianceList violations={[]} />);
    expect(screen.getByTestId("minor-compliance-clear")).toBeInTheDocument();
  });

  it("lists each violation with the employee, age, and issues", () => {
    render(<MinorComplianceList violations={violations} />);
    const row = screen.getByTestId("minor-violation-1");
    expect(within(row).getByText(/Teen A/)).toBeInTheDocument();
    expect(within(row).getByText(/age 16/)).toBeInTheDocument();
    expect(within(row).getByText("Ends after 10:00 PM")).toBeInTheDocument();
    expect(within(row).getByText("Exceeds 8h/day")).toBeInTheDocument();
  });
});
