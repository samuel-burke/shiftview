import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoverageHeader from "./CoverageHeader";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

// Use local date constructor to avoid UTC-offset shifting the date in jsdom
const today = new Date(2026, 4, 25); // May 25, 2026

const baseProps = {
  date: today,
  today,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onNow: vi.fn(),
  onDateSelect: vi.fn(),
  isToday: true,
  hereCount: 2,
  nowMinutes: 600, // 10am
  coverageStatus: "optimal" as const,
  isDemo: false,
};

describe("CoverageHeader", () => {
  it("renders without crashing", () => {
    render(<CoverageHeader {...baseProps} />);
  });

  it("displays the formatted date", () => {
    render(<CoverageHeader {...baseProps} />);
    expect(screen.getAllByText(/May 25, 2026/)[0]).toBeInTheDocument();
  });

  it("displays the day name in the brand sub-line", () => {
    render(<CoverageHeader {...baseProps} />);
    // Day name appears in the "Monday · June 2, 2026" sub-line under the logo
    expect(screen.getByText(/Monday/)).toBeInTheDocument();
  });

  it("does not show the live time label (removed from UI)", () => {
    render(<CoverageHeader {...baseProps} />);
    expect(screen.queryByText(/Live:/)).not.toBeInTheDocument();
  });

  it("does not show TODAY button when viewing today", () => {
    render(<CoverageHeader {...baseProps} isToday={true} />);
    expect(screen.queryByText("TODAY")).not.toBeInTheDocument();
  });

  it("shows TODAY button when viewing a different day", () => {
    const pastDate = new Date(2026, 4, 20);
    render(<CoverageHeader {...baseProps} date={pastDate} isToday={false} />);
    expect(screen.getByText("TODAY")).toBeInTheDocument();
  });

  it("calls onNow when TODAY button is clicked", async () => {
    const onNow = vi.fn();
    const pastDate = new Date(2026, 4, 20);
    render(
      <CoverageHeader {...baseProps} date={pastDate} isToday={false} onNow={onNow} />
    );
    await userEvent.click(screen.getByText("TODAY"));
    expect(onNow).toHaveBeenCalledOnce();
  });

  it("calls onPrev/onNext when nav arrows are clicked", async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<CoverageHeader {...baseProps} onPrev={onPrev} onNext={onNext} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Previous day" })[0]);
    await userEvent.click(screen.getAllByRole("button", { name: "Next day" })[0]);
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("shows critical alert when coverage is critical", () => {
    render(<CoverageHeader {...baseProps} coverageStatus="critical" hereCount={1} />);
    expect(screen.getByText(/Coverage below minimum/)).toBeInTheDocument();
  });

  it("shows low coverage alert when coverage is low", () => {
    render(<CoverageHeader {...baseProps} coverageStatus="low" hereCount={2} />);
    expect(screen.getByText(/Coverage below optimal/)).toBeInTheDocument();
  });

  it("shows no alert when coverage is optimal", () => {
    render(<CoverageHeader {...baseProps} coverageStatus="optimal" />);
    expect(screen.queryByText(/Coverage/)).not.toBeInTheDocument();
  });

  it("shows Sign In in the user menu dropdown when onSignIn is provided", async () => {
    render(<CoverageHeader {...baseProps} onSignIn={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  it("shows Sign Out in the user menu dropdown when onSignOut is provided", async () => {
    render(<CoverageHeader {...baseProps} onSignOut={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });
});
