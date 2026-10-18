import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PayrollPeriodPanel from "./PayrollPeriodPanel";

const view = (over: Record<string, unknown> = {}) => ({
  id: 3, start: "2026-10-05", end: "2026-10-11", status: "open", approvedAt: null, lockedAt: null, signoffs: [], ...over,
}) as any;

const employees = [
  { employeeId: 1, employeeName: "Ann Lee" },
  { employeeId: 2, employeeName: "Bo Diaz" },
  { employeeId: 3, employeeName: "Cy Ng" },
];

function mockFetch(status = 200, body: unknown = { ok: true }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

function renderPanel(info: any, extra: Partial<Parameters<typeof PayrollPeriodPanel>[0]> = {}) {
  const onChanged = vi.fn();
  const onUseRange = vi.fn();
  render(
    <PayrollPeriodPanel info={info} employees={employees} timezone="America/New_York"
      onChanged={onChanged} onUseRange={onUseRange} {...extra} />,
  );
  return { onChanged, onUseRange };
}

describe("PayrollPeriodPanel", () => {
  it("renders nothing when the store doesn't use pay periods", () => {
    const { container } = render(
      <PayrollPeriodPanel info={null} employees={employees} timezone="UTC" onChanged={() => {}} onUseRange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("an open period: warns before export and offers Approve", async () => {
    const fetchMock = mockFetch();
    const { onChanged } = renderPanel({ period: view(), overlapping: [view()] });
    expect(screen.getByTestId("payroll-period-status")).toHaveTextContent("Open");
    expect(screen.getByText(/isn.t locked: its hours can still change after you export/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ action: "approve", date: "2026-10-05" });
    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
  });

  it("an approved period: still warns, offers Lock and Reopen", async () => {
    const fetchMock = mockFetch();
    const { onChanged } = renderPanel({ period: view({ status: "approved" }), overlapping: [] });
    expect(screen.getByText(/Lock it before paying/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ action: "lock", date: "2026-10-05" });
  });

  it("a locked period: no warning; reopening needs a reason", async () => {
    const fetchMock = mockFetch();
    const { onChanged } = renderPanel({ period: view({ status: "locked" }), overlapping: [] });
    expect(screen.getByTestId("payroll-period-status")).toHaveTextContent("Locked");
    expect(screen.queryByText(/isn.t locked/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const confirm = screen.getByRole("button", { name: "Reopen" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for reopening"), { target: { value: "Missed clock-out" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      action: "reopen", date: "2026-10-05", reason: "Missed clock-out",
    });
  });

  it("shows the server's refusal", async () => {
    mockFetch(400, { error: "A pay period can be approved once it has ended (after 2026-10-11)" });
    const { onChanged } = renderPanel({ period: view(), overlapping: [] });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/once it has ended/);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("lists each employee's sign-off status", () => {
    renderPanel({
      period: view({
        status: "approved",
        signoffs: [
          { employeeId: 1, status: "signed", note: null, signedAt: "2026-10-12T02:00:00Z" },
          { employeeId: 2, status: "disputed", note: "Missing Thursday", signedAt: "2026-10-12T03:00:00Z" },
        ],
      }),
      overlapping: [],
    });
    expect(screen.getByText(/1 of 3 signed/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("payroll-signoff-row");
    // Signed late on Oct 11 in New York (02:00 UTC on the 12th).
    expect(rows[0]).toHaveTextContent("Ann LeeSigned Oct 11");
    expect(rows[1]).toHaveTextContent("Disputed: Missing Thursday");
    expect(rows[2]).toHaveTextContent("Not signed");
  });

  it("a range that isn't a pay period offers the periods it touches", () => {
    const { onUseRange } = renderPanel({
      period: null,
      overlapping: [view({ start: "2026-10-05", end: "2026-10-11" }), view({ start: "2026-10-12", end: "2026-10-18" })],
    });
    expect(screen.getByText(/aren.t a single pay period/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Mon, Oct 12 – Sun, Oct 18" }));
    expect(onUseRange).toHaveBeenCalledWith("2026-10-12", "2026-10-18");
  });
});
