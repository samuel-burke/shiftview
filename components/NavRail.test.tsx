import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NavRail from "./NavRail";

vi.mock("@/lib/AppDataContext", () => ({
  useAppData: () => ({ liveStatus: "clocked_in" }),
}));

describe("NavRail", () => {
  it("shows every employee destination and marks the active one", () => {
    render(<NavRail active="schedule" />);
    for (const name of ["Team", "Schedule", "Clock", "Reports", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Team" })).not.toHaveAttribute("aria-current");
  });

  it("shows Planner and Admin only to managers", () => {
    const { rerender } = render(<NavRail active="team" />);
    expect(screen.queryByRole("link", { name: "Planner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();

    rerender(<NavRail active="team" isManager />);
    expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute("href", "/draft");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("shows the live clock status as an accessible dot", () => {
    render(<NavRail active="team" />);
    expect(screen.getByRole("status", { name: "Clocked In" })).toBeInTheDocument();
  });
});
