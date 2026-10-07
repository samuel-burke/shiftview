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

  it("shows Week and Admin only to managers", () => {
    const { rerender } = render(<NavRail active="team" />);
    expect(screen.queryByRole("link", { name: "Week" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();

    rerender(<NavRail active="team" isManager />);
    // The Week page holds both the live schedule and drafts; there's no separate Planner.
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute("href", "/week");
    expect(screen.queryByRole("link", { name: "Planner" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("shows the live clock status as an accessible dot", () => {
    render(<NavRail active="team" />);
    expect(screen.getByRole("status", { name: "Clocked In" })).toBeInTheDocument();
  });

  it("offers to expand into the full sidebar only when the shell allows it", () => {
    const { rerender } = render(<NavRail active="team" />);
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();

    const onExpand = vi.fn();
    rerender(<NavRail active="team" onExpand={onExpand} />);
    screen.getByRole("button", { name: "Expand sidebar" }).click();
    expect(onExpand).toHaveBeenCalledOnce();
  });
});
