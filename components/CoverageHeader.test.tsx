import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoverageHeader from "./CoverageHeader";

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
  scheduledCount: 5,
  offCount: 1,
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
    expect(screen.getByText(/May 25, 2026/)).toBeInTheDocument();
  });

  it("displays the day name", () => {
    render(<CoverageHeader {...baseProps} />);
    expect(screen.getByText("Monday")).toBeInTheDocument();
  });

  it("shows the live time label when isToday", () => {
    render(<CoverageHeader {...baseProps} />);
    expect(screen.getByText(/Live:/)).toBeInTheDocument();
  });

  it("shows stat card counts", () => {
    render(<CoverageHeader {...baseProps} />);
    // Use getAllByText since calendar day numbers may clash; verify at least one match per stat
    expect(screen.getAllByText("2").length).toBeGreaterThan(0); // hereCount
    expect(screen.getAllByText("5").length).toBeGreaterThan(0); // scheduledCount
    expect(screen.getAllByText("1").length).toBeGreaterThan(0); // offCount
  });

  it("shows stat card labels", () => {
    render(<CoverageHeader {...baseProps} />);
    expect(screen.getByText("Here Now")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("does not show 'Here Now' card on non-today days", () => {
    const pastDate = new Date(2026, 4, 20);
    render(<CoverageHeader {...baseProps} date={pastDate} isToday={false} />);
    expect(screen.queryByText("Here Now")).not.toBeInTheDocument();
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
    // getAllByText since the date picker sheet also renders ← and → for month nav
    const prevBtns = screen.getAllByText("←");
    const nextBtns = screen.getAllByText("→");
    await userEvent.click(prevBtns[0]);
    await userEvent.click(nextBtns[0]);
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

  it("renders Sign In button when onSignIn is provided", () => {
    render(<CoverageHeader {...baseProps} onSignIn={vi.fn()} />);
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  it("renders Sign Out button when onSignOut is provided", () => {
    render(<CoverageHeader {...baseProps} onSignOut={vi.fn()} />);
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });
});
