import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AutoScheduleSheet, { describeAdjustment, type PlannerEmployee } from "./AutoScheduleSheet";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import type { CoverageBlock } from "@/lib/coverage";

// Sun Oct 11 – Sat Oct 17, 2026.
const DATES = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const DAY_TARGET: CoverageBlock[] = [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }];
const EVERY_DAY = Object.fromEntries(DATES.map((d) => [d, DAY_TARGET]));

const EMPLOYEES: PlannerEmployee[] = [
  { id: 1, name: "Alex Rivera", employment_type: "full_time" },
  { id: 2, name: "Sam Lee", employment_type: null },
];

function mockTimeOff(requests: { employeeId: number; date: string; status: string }[] = []) {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requests }) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderSheet(props: Partial<React.ComponentProps<typeof AutoScheduleSheet>> = {}) {
  const onGenerate = vi.fn();
  const onClose = vi.fn();
  const onSetEmploymentType = vi.fn().mockResolvedValue(undefined);
  render(
    <AutoScheduleSheet
      open
      onClose={onClose}
      weekLabel="Oct 11 – Oct 17, 2026"
      dates={DATES}
      employees={EMPLOYEES}
      draftCount={0}
      curves={EVERY_DAY}
      rules={DEFAULT_SCHEDULING_RULES}
      initialAdjustments={[]}
      generating={false}
      error={null}
      onGenerate={onGenerate}
      onSetEmploymentType={onSetEmploymentType}
      {...props}
    />
  );
  return { onGenerate, onClose, onSetEmploymentType };
}

describe("AutoScheduleSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimeOff();
  });

  it("renders nothing when closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByTestId("auto-schedule-sheet")).toBeNull();
  });

  it("generates a fresh week with the org's rules when there are no drafts", () => {
    const { onGenerate } = renderSheet();
    // Nothing to keep, so no choice about existing drafts.
    expect(screen.queryByRole("radiogroup", { name: "What to do with your drafts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate Schedule" }));
    expect(onGenerate).toHaveBeenCalledWith({
      mode: "replace",
      rules: { overtimePolicy: "never", pendingTimeOff: "avoid" },
      adjustments: [],
    });
  });

  it("keeps existing drafts by default and can start fresh instead", () => {
    const { onGenerate } = renderSheet({ draftCount: 4 });
    expect(screen.getByText("Your 4 drafts")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Keep & fill around" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Generate Schedule" }));
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "fill" }));

    fireEvent.click(screen.getByRole("radio", { name: "Start fresh" }));
    expect(screen.getByText("Your drafts are replaced. Undo brings them back.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate Schedule" }));
    expect(onGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "replace" }));
  });

  it("sends this run's overtime and pending time-off choices", () => {
    const { onGenerate } = renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "To fill gaps" }));
    fireEvent.click(screen.getByRole("radio", { name: "Ignore" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Schedule" }));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ rules: { overtimePolicy: "when_needed", pendingTimeOff: "ignore" } })
    );
  });

  it("warns about days without a coverage target", () => {
    // Sunday to Friday only.
    renderSheet({ curves: Object.fromEntries(DATES.slice(0, 6).map((d) => [d, DAY_TARGET])) });
    expect(screen.getByText(/No coverage target on Sat; nobody will be scheduled then/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Schedule" })).toBeEnabled();
  });

  it("can't generate without any coverage targets", () => {
    renderSheet({ curves: {} });
    expect(screen.getByText(/No coverage targets this week/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set coverage" })).toHaveAttribute("href", "/coverage");
    expect(screen.getByRole("button", { name: "Generate Schedule" })).toBeDisabled();
  });

  it("sets a missing employment type inline", async () => {
    const { onSetEmploymentType } = renderSheet();
    expect(screen.getByText(/1 person has no employment type/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set them now" }));
    const row = screen.getByText("Sam L.").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Part-time" }));
    await waitFor(() => expect(onSetEmploymentType).toHaveBeenCalledWith(2, "part_time"));
  });

  it("counts pending time-off requests in the week", async () => {
    mockTimeOff([
      { employeeId: 1, date: "2026-10-13", status: "pending" },
      { employeeId: 2, date: "2026-10-30", status: "pending" }, // another week
    ]);
    renderSheet();
    expect(await screen.findByText(/1 pending time-off request this week/)).toBeInTheDocument();
  });

  it("adds and removes this week's adjustments", () => {
    const { onGenerate } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "+ Extra people" }));
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-16" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "960" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "1080" } });
    fireEvent.change(screen.getByLabelText("People"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Fri 4:00 PM–6:00 PM: +2 people")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Someone's hours" }));
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Most hours this week"), { target: { value: "34" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Sam L.: up to 34 h")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Keep someone off" }));
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Alex R. off Mon" }));

    fireEvent.click(screen.getByRole("button", { name: "Generate Schedule" }));
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustments: [
          { kind: "coverage", date: "2026-10-16", startMinutes: 960, endMinutes: 1080, delta: 2 },
          { kind: "employee_hours", employeeId: 2, minHours: null, maxHours: 34 },
        ],
      })
    );
  });

  it("ignores a coverage change that ends before it starts", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "+ Extra people" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "720" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("starts from the last run's adjustments", () => {
    renderSheet({ initialAdjustments: [{ kind: "employee_off", employeeId: 1, date: "2026-10-14" }] });
    expect(screen.getByText("Alex R. off Wed")).toBeInTheDocument();
  });

  it("shows the error and locks closing while generating", () => {
    const { onClose } = renderSheet({ generating: true, error: "Couldn't generate a schedule" });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't generate a schedule");
    expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("describeAdjustment", () => {
  const nameOf = (id: number) => (id === 1 ? "Alex R." : "Sam L.");

  it("describes each kind of adjustment", () => {
    expect(describeAdjustment({ kind: "coverage", date: "2026-10-12", startMinutes: 540, endMinutes: 600, delta: -1 }, nameOf))
      .toBe("Mon 9:00 AM–10:00 AM: −1 person");
    expect(describeAdjustment({ kind: "employee_off", employeeId: 2, date: "2026-10-17" }, nameOf)).toBe("Sam L. off Sat");
    expect(describeAdjustment({ kind: "employee_hours", employeeId: 1, minHours: 20, maxHours: 44 }, nameOf))
      .toBe("Alex R.: at least 20 h, up to 44 h");
  });
});
