import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import IncidentLog, { type Incident } from "./IncidentLog";

const incidents: Incident[] = [
  { id: 1, employeeName: "Sam", date: "2026-06-17", severity: "severe", description: "Cut requiring stitches" },
  { id: 2, employeeName: null, date: "2026-06-16", severity: "minor", description: "Customer slipped, no injury" },
];

describe("IncidentLog", () => {
  it("shows an empty state", () => {
    render(<IncidentLog incidents={[]} />);
    expect(screen.getByText(/no incidents reported/i)).toBeInTheDocument();
  });

  it("renders each incident with severity and description", () => {
    render(<IncidentLog incidents={incidents} />);
    expect(within(screen.getByTestId("incident-1")).getByText("Severe")).toBeInTheDocument();
    expect(within(screen.getByTestId("incident-1")).getByText(/Sam/)).toBeInTheDocument();
    expect(within(screen.getByTestId("incident-1")).getByText(/Cut requiring stitches/)).toBeInTheDocument();
  });

  it("handles an incident with no named employee", () => {
    render(<IncidentLog incidents={incidents} />);
    const row = screen.getByTestId("incident-2");
    expect(within(row).getByText("Minor")).toBeInTheDocument();
    expect(within(row).queryByText(/·\s*null/)).not.toBeInTheDocument();
  });
});
