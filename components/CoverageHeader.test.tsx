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
    // It keeps its room (invisible) so the header doesn't reflow between days.
    expect(screen.queryByRole("button", { name: "TODAY" })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Critically below coverage target/)).toBeInTheDocument();
  });

  it("shows low coverage alert when coverage is low", () => {
    render(<CoverageHeader {...baseProps} coverageStatus="low" hereCount={2} />);
    expect(screen.getByText(/Below coverage target/)).toBeInTheDocument();
  });

  it("shows a calm on-target status, not a warning, when coverage is optimal", () => {
    render(<CoverageHeader {...baseProps} coverageStatus="optimal" hereCount={4} />);
    expect(screen.getByRole("status")).toHaveTextContent("On target — 4 here now");
    expect(screen.queryByText(/below coverage target/i)).not.toBeInTheDocument();
  });

  it("holds the status line with a placeholder while today's coverage loads", () => {
    render(<CoverageHeader {...baseProps} loading coverageStatus="low" />);
    expect(screen.getByRole("status", { name: "Loading coverage status" })).toBeInTheDocument();
    expect(screen.queryByText(/Below coverage target/)).not.toBeInTheDocument();
  });

  it("offers Back to Today in the status line when viewing another day", async () => {
    const onNow = vi.fn();
    render(<CoverageHeader {...baseProps} date={new Date(2026, 4, 20)} isToday={false} onNow={onNow} />);
    expect(screen.getByText("Viewing past schedule")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(onNow).toHaveBeenCalledOnce();
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
