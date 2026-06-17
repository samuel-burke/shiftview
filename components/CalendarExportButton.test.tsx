import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CalendarExportButton from "./CalendarExportButton";

describe("CalendarExportButton", () => {
  it("links to the calendar endpoint as a download", () => {
    render(<CalendarExportButton />);
    const link = screen.getByTestId("calendar-export-button");
    expect(link).toHaveAttribute("href", "/api/my-schedule/calendar");
    expect(link).toHaveAttribute("download", "my-shifts.ics");
  });

  it("has an accessible label and visible text", () => {
    render(<CalendarExportButton />);
    expect(screen.getByRole("link", { name: /download my shifts/i })).toBeInTheDocument();
    expect(screen.getByText(/add to calendar/i)).toBeInTheDocument();
  });

  it("applies a custom className when provided", () => {
    render(<CalendarExportButton className="custom-cls" />);
    expect(screen.getByTestId("calendar-export-button")).toHaveClass("custom-cls");
  });
});
