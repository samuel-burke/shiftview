import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import MyHours from "./MyHours";

const day = (date: string, over: Record<string, unknown> = {}) => ({
  date, dayName: "Mon", schedule: null, schedules: [], punches: [], callout: null,
  workedHours: 8, breakHours: 0.5, breakCount: 1, hasIncomplete: false, violations: [], ...over,
});
const week = (weekStart: string, worked: number) => ({
  weekStart, priorHours: 0, regularHours: Math.min(worked, 40), overtimeHours: Math.max(0, worked - 40),
  breakHours: 2, totalWorkedHours: worked, hasIncomplete: false, days: [],
});

function mockTimecard(body: unknown, status = 200) {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

// Wednesday Oct 14, 2026: this week is Oct 12–18, last week Oct 5–11.
const TODAY = "2026-10-14";

describe("MyHours", () => {
  it("asks for the caller's own time card over last week and this one", async () => {
    const fetchMock = mockTimecard({ days: [], weeks: [] });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    await screen.findByText(/No hours recorded this week/);
    expect(fetchMock).toHaveBeenCalledWith("/api/timecard?employeeId=5&from=2026-10-05&to=2026-10-18");
  });

  it("shows this week's worked, regular and overtime hours and each day", async () => {
    mockTimecard({
      days: [
        day("2026-10-12", { workedHours: 7.5, violations: [{ type: "late_in", label: "Late In", detail: "" }] }),
        day("2026-10-13", { workedHours: 9, breakHours: 0 }),
      ],
      weeks: [week("2026-10-12", 16.5)],
    });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByTestId("my-hours-worked")).toHaveTextContent("16h 30m");
    expect(screen.getByTestId("my-hours-regular")).toHaveTextContent("16h 30m");
    expect(screen.getByTestId("my-hours-overtime")).toHaveTextContent("0h");
    const rows = screen.getAllByTestId("my-hours-day");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Mon, Oct 12");
    expect(rows[0]).toHaveTextContent("7h 30m");
    expect(rows[0]).toHaveTextContent("30m break");
    expect(within(rows[0]).getByText("Late")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("9h");
    expect(screen.queryByText(/until overtime/)).not.toBeInTheDocument();
  });

  it("switches to last week", async () => {
    mockTimecard({
      days: [day("2026-10-06", { workedHours: 10, hasIncomplete: true }), day("2026-10-12")],
      weeks: [week("2026-10-05", 44), week("2026-10-12", 8)],
    });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByTestId("my-hours-worked")).toHaveTextContent("8h");
    fireEvent.click(screen.getByRole("radio", { name: "Last week" }));
    expect(screen.getByTestId("my-hours-worked")).toHaveTextContent("44h");
    expect(screen.getByTestId("my-hours-regular")).toHaveTextContent("40h");
    expect(screen.getByTestId("my-hours-overtime")).toHaveTextContent("4h");
    expect(screen.getByText(/Mon, Oct 5 – Sun, Oct 11/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("my-hours-day");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Missing punch")).toBeInTheDocument();
    // The overtime notices are about the week in progress only.
    expect(screen.queryByText(/in overtime this week/)).not.toBeInTheDocument();
  });

  it("warns as overtime gets close", async () => {
    mockTimecard({ days: [], weeks: [week("2026-10-12", 37)] });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByText(/3h until overtime/)).toBeInTheDocument();
  });

  it("says when this week is already in overtime", async () => {
    mockTimecard({ days: [], weeks: [week("2026-10-12", 41)] });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByText(/in overtime this week/)).toBeInTheDocument();
    expect(screen.getByTestId("my-hours-overtime")).toHaveTextContent("1h");
  });

  it("notes a shift still running today", async () => {
    mockTimecard({ days: [day(TODAY, { hasIncomplete: true, workedHours: 0 })], weeks: [] });
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByText(/current shift is added when you clock out/)).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    mockTimecard({ error: "No employee record linked to this account" }, 403);
    render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="" />);
    expect(await screen.findByText("No employee record linked to this account")).toBeInTheDocument();
  });

  it("reloads when the punches change", async () => {
    const fetchMock = mockTimecard({ days: [], weeks: [] });
    const { rerender } = render(<MyHours employeeId={5} todayKey={TODAY} refreshKey="1" />);
    await screen.findByText(/No hours recorded/);
    rerender(<MyHours employeeId={5} todayKey={TODAY} refreshKey="1,2" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
