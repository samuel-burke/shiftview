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

describe("TimeCardPanel — split shifts", () => {
  it("shows every scheduled shift of the day", () => {
    const split = computeTimecard({
      employeeId: 3, employeeName: "Alex Rivera", from: "2026-10-06", to: "2026-10-06", timezone: TZ,
      policy: DEFAULT_PUNCH_POLICY,
      schedules: [
        { date: "2026-10-06", startMinutes: 480, endMinutes: 720 },
        { date: "2026-10-06", startMinutes: 1020, endMinutes: 1260 },
      ],
      punches: [
        { id: 1, punchType: "clock_in", punchedAt: "2026-10-06T12:00:00Z" },
        { id: 2, punchType: "clock_out", punchedAt: "2026-10-06T16:00:00Z" },
        { id: 3, punchType: "clock_in", punchedAt: "2026-10-06T21:00:00Z" },
        { id: 4, punchType: "clock_out", punchedAt: "2026-10-07T01:00:00Z" },
      ],
      callouts: [],
      nowMs: Date.parse("2026-10-08T02:00:00Z"),
    });
    render(
      <TimeCardPanel
        employee={{ id: 3, name: "Alex Rivera" }} from={split.from} to={split.to}
        onFromChange={() => {}} onToChange={() => {}} onApply={() => {}} onClose={() => {}} onExport={vi.fn()}
        data={split} loading={false} error={null}
      />
    );
    expect(screen.getByText("8:00 AM – 12:00 PM, 5:00 PM – 9:00 PM")).toBeInTheDocument();
  });
});

describe("TimeCardPanel — pay period sign-off", () => {
  function withPeriods(payPeriods: unknown[]) {
    render(
      <TimeCardPanel
        employee={{ id: 3, name: "Alex Rivera" }} from={card.from} to={card.to}
        onFromChange={() => {}} onToChange={() => {}} onApply={() => {}} onClose={() => {}} onExport={vi.fn()}
        data={{ ...card, payPeriods } as any} loading={false} error={null}
      />
    );
  }

  it("shows nothing when the store doesn't use pay periods", () => {
    withPeriods([]);
    expect(screen.queryByTestId("timecard-pay-period")).toBeNull();
  });

  it("shows each period's status and the employee's sign-off, in store time", () => {
    withPeriods([
      { start: "2026-09-28", end: "2026-10-04", status: "locked",
        signoff: { employeeId: 3, status: "signed", note: null, signedAt: "2026-10-05T01:30:00Z" } },
      { start: "2026-10-05", end: "2026-10-11", status: "open",
        signoff: { employeeId: 3, status: "disputed", note: "Missing Thursday", signedAt: "2026-10-12T01:30:00Z" } },
      { start: "2026-10-12", end: "2026-10-18", status: "approved", signoff: null },
    ]);
    const rows = screen.getAllByTestId("timecard-pay-period");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Pay period Mon, Sep 28 – Sun, Oct 4");
    expect(rows[0]).toHaveTextContent("Locked");
    // 01:30 UTC on Oct 5 is 9:30 PM on Oct 4 in New York.
    expect(rows[0]).toHaveTextContent("Signed Oct 4 9:30 PM");
    expect(rows[1]).toHaveTextContent("Open");
    expect(rows[1]).toHaveTextContent("Disputed");
    expect(rows[1]).toHaveTextContent("Missing Thursday");
    expect(rows[2]).toHaveTextContent("Approved");
    expect(rows[2]).toHaveTextContent("Not signed");
  });
});
