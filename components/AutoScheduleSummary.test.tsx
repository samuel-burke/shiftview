import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AutoScheduleSummary from "./AutoScheduleSummary";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import type { GenerationRun, ScheduleGap } from "@/lib/scheduler/types";

const EMPLOYEES = [
  { id: 1, name: "Alex Rivera" },
  { id: 2, name: "Sam Lee" },
  { id: 3, name: "Jordan Kim" },
];

function gap(date: string, startMinutes: number, endMinutes: number, overrides: Partial<ScheduleGap> = {}): ScheduleGap {
  return { date, startMinutes, endMinutes, shortfall: 1, reasons: [], ...overrides };
}

function makeRun(overrides: Partial<GenerationRun> = {}): GenerationRun {
  return {
    runId: 7,
    weekStart: "2026-10-11",
    mode: "replace",
    seed: 42,
    createdAt: "2026-10-06T15:30:00Z",
    rules: DEFAULT_SCHEDULING_RULES,
    adjustments: [],
    metrics: {
      coverageScore: 96,
      coverageScoreBefore: 0,
      budgetHours: 266,
      scheduledHours: 262,
      generatedHours: 262,
      generatedShifts: 38,
      shortfallHours: 4,
      overstaffHours: 0,
      overtimeHours: 0,
      laborCost: 4321.5,
      employeesMissingRate: 1,
      preferenceScore: 88,
    },
    gaps: [],
    suggestions: [],
    warnings: [],
    employees: [],
    ...overrides,
  };
}

function renderSummary(run: GenerationRun, props: Partial<React.ComponentProps<typeof AutoScheduleSummary>> = {}) {
  const handlers = { onUndo: vi.fn(), onTryAnother: vi.fn(), onApplySuggestion: vi.fn(), onDismiss: vi.fn() };
  render(<AutoScheduleSummary run={run} employees={EMPLOYEES} busy={null} error={null} {...handlers} {...props} />);
  return handlers;
}

describe("AutoScheduleSummary", () => {
  it("shows what the run did", () => {
    renderSummary(makeRun());
    expect(screen.getByRole("heading", { name: /Auto-scheduled 38 shifts/ })).toBeInTheDocument();
    expect(screen.getByText(/Started fresh/)).toBeInTheDocument();
    expect(screen.getByText("0% → 96%")).toBeInTheDocument();
    expect(screen.getByText("262 / 266")).toBeInTheDocument();
    expect(screen.getByText("$4,322")).toBeInTheDocument();
    expect(screen.getByText("1 without a rate")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
  });

  it("doesn't show a labor cost when nobody scheduled has a pay rate", () => {
    const run = makeRun();
    renderSummary({ ...run, metrics: { ...run.metrics, laborCost: 0, employeesMissingRate: 3 } });
    expect(screen.queryByText("$0")).toBeNull();
    expect(screen.getByText("3 without a rate")).toBeInTheDocument();
  });

  it("says when every hour of the target is met", () => {
    renderSummary(makeRun());
    expect(screen.getByText(/Every hour of the coverage target is met/)).toBeInTheDocument();
  });

  it("explains each gap with who couldn't cover it and why", () => {
    renderSummary(
      makeRun({
        gaps: [
          gap("2026-10-11", 1080, 1200, {
            shortfall: 2,
            reasons: [
              { code: "unavailable", employeeIds: [1, 2, 3, 4, 5] },
              { code: "max_hours", employeeIds: [2, 3] },
            ],
          }),
        ],
      })
    );
    expect(screen.getByText("1 gap left")).toBeInTheDocument();
    expect(screen.getByText(/Sun 6:00 PM–8:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/short 2/)).toBeInTheDocument();
    expect(screen.getByText("5 people: unavailable · Sam L., Jordan K.: at their weekly hours")).toBeInTheDocument();
  });

  it("collapses a long gap list", () => {
    renderSummary(
      makeRun({ gaps: [600, 660, 720, 780, 840].map((start) => gap("2026-10-12", start, start + 30)) })
    );
    expect(screen.getAllByText("Nobody on the roster")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Show all 5" }));
    expect(screen.getAllByText("Nobody on the roster")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("lists the run's warnings", () => {
    renderSummary(
      makeRun({
        warnings: [
          { code: "no_coverage_target", dates: ["2026-10-11", "2026-10-17"] },
          { code: "employment_type_missing", employeeIds: [2] },
          { code: "pending_time_off_scheduled", employeeIds: [1, 3] },
        ],
      })
    );
    expect(screen.getByText("No coverage target on Sun, Sat, so nobody was scheduled then.")).toBeInTheDocument();
    expect(screen.getByText("1 person has no employment type and was scheduled as part-time.")).toBeInTheDocument();
    expect(screen.getByText("Scheduled on a day they asked off (pending): Alex R., Jordan K.")).toBeInTheDocument();
  });

  it("offers one-tap fixes", () => {
    const suggestion = { kind: "raise_hours" as const, employeeId: 2, maxHours: 44, overtime: true, gapMinutes: 120 };
    const { onApplySuggestion } = renderSummary(
      makeRun({
        gaps: [gap("2026-10-12", 600, 720)],
        suggestions: [suggestion, { kind: "raise_hours", employeeId: 3, maxHours: 32, overtime: false, gapMinutes: 60 }],
      })
    );
    expect(screen.getByRole("button", { name: "Let Jordan K. work up to 32 h" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow Sam L. 44 h (overtime)" }));
    expect(onApplySuggestion).toHaveBeenCalledWith(suggestion);
  });

  it("tries another version, undoes and dismisses", () => {
    const { onTryAnother, onUndo, onDismiss } = renderSummary(makeRun());
    fireEvent.click(screen.getByRole("button", { name: "Try Another Version" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss summary" }));
    expect(onTryAnother).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("locks its actions while one is running and shows errors", () => {
    renderSummary(makeRun({ suggestions: [{ kind: "raise_hours", employeeId: 1, maxHours: 40, overtime: false, gapMinutes: 60 }] }), {
      busy: "undo",
      error: "Couldn't undo",
    });
    expect(screen.getByRole("button", { name: "Undoing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try Another Version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Let Alex R. work up to 40 h" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't undo");
  });

  it("notes when the run kept the manager's drafts and used adjustments", () => {
    renderSummary(
      makeRun({ mode: "fill", adjustments: [{ kind: "employee_off", employeeId: 1, date: "2026-10-12" }] })
    );
    expect(screen.getByText(/Around your drafts/)).toHaveTextContent("1 adjustment");
  });
});
