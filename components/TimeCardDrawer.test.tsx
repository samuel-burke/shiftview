import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeCardPanel } from "./TimeCardDrawer";
import { computeTimecard } from "@/lib/timecard";
import { DEFAULT_PUNCH_POLICY } from "@/lib/punch-policy";

const TZ = "America/New_York";
// Tue Oct 6: on time, out from an approved correction. Wed Oct 7: 10 min late.
const card = computeTimecard({
  employeeId: 3,
  employeeName: "Alex Rivera",
  from: "2026-10-06",
  to: "2026-10-07",
  timezone: TZ,
  policy: DEFAULT_PUNCH_POLICY,
  schedules: [
    { date: "2026-10-06", startMinutes: 780, endMinutes: 1260 },
    { date: "2026-10-07", startMinutes: 780, endMinutes: 1260 },
  ],
  punches: [
    { id: 1, punchType: "clock_in", punchedAt: "2026-10-06T16:59:00Z" },
    { id: 2, punchType: "clock_out", punchedAt: "2026-10-07T01:00:00Z", isManual: true, note: "Forgot to clock out" },
    { id: 3, punchType: "clock_in", punchedAt: "2026-10-07T17:10:00Z" },
    { id: 4, punchType: "clock_out", punchedAt: "2026-10-08T01:02:00Z" },
  ],
  callouts: [],
  nowMs: Date.parse("2026-10-08T02:00:00Z"),
});

function panel(onExport = vi.fn()) {
  render(
    <div>
      <TimeCardPanel
        employee={{ id: 3, name: "Alex Rivera" }}
        from={card.from}
        to={card.to}
        onFromChange={() => {}}
        onToChange={() => {}}
        onApply={() => {}}
        onClose={() => {}}
        onExport={onExport}
        data={card}
        loading={false}
        error={null}
      />
    </div>
  );
  return onExport;
}

describe("TimeCardPanel", () => {
  it("totals the period and counts its flags", () => {
    panel();
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    expect(screen.getByText("15.9")).toBeInTheDocument(); // 8.02 h + 7.87 h
    expect(screen.getByText("Late In · 1")).toBeInTheDocument();
  });

  it("lists each day's punches with its flags and manual corrections", () => {
    panel();
    const body = screen.getByTestId("timecard-body");
    const tue = within(body).getByText("Tue, Oct 6").closest("div.bg-card") as HTMLElement;
    expect(within(tue).getByText("12:59 PM")).toBeInTheDocument();
    expect(within(tue).getByTitle("Manual correction")).toBeInTheDocument();
    expect(within(tue).queryByText("Late In")).toBeNull();

    const wed = within(body).getByText("Wed, Oct 7").closest("div.bg-card") as HTMLElement;
    expect(within(wed).getByText("Late In")).toBeInTheDocument();
    expect(within(wed).getByText("Clocked in 10 min late (scheduled 1:00 PM)")).toBeInTheDocument();
    expect(within(wed).getByText("1:10 PM")).toBeInTheDocument();
  });

  it("exports the period", async () => {
    const onExport = panel();
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});
