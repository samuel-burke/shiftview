import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmployeePayRow, { fmtEffective, parseRate } from "./EmployeePayRow";

const RATES = {
  rates: [
    { id: 2, positionId: null, effectiveFrom: "2026-06-10", hourlyRate: 20 },
    { id: 3, positionId: 5, effectiveFrom: "2026-06-01", hourlyRate: 25 },
    { id: 1, positionId: null, effectiveFrom: "1900-01-01", hourlyRate: 15 },
  ],
  today: "2026-06-15",
  beginning: "1900-01-01",
};

function mockFetch({ postOk = true, postBody = { ok: true } as unknown } = {}) {
  const fn = vi.fn().mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/positions") return { ok: true, json: async () => ({ positions: [{ id: 5, name: "Shift Lead" }] }) };
    if (url.includes("/pay-rates") && (!init || init.method === undefined)) return { ok: true, json: async () => RATES };
    if (url.includes("/pay-rates") && init?.method === "POST") return { ok: postOk, json: async () => postBody };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const body = (fetchMock: ReturnType<typeof vi.fn>, method: string, match: string) => {
  const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes(match) && init?.method === method);
  return call ? JSON.parse(call[1].body) : undefined;
};

describe("EmployeePayRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarizes the rate and payroll ID without loading anything", () => {
    const fetchMock = mockFetch();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann", pay_rate: 18.5, payroll_id: "G-7" }} onSaved={() => {}} />);
    expect(screen.getByText("$18.50/h · ID G-7")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags an employee with no rate", () => {
    mockFetch();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann" }} onSaved={() => {}} />);
    expect(screen.getByText("No rate")).toHaveClass("text-warning-fg");
  });

  it("loads the history when opened, with position names and dates", async () => {
    mockFetch();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann", pay_rate: 20 }} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    const list = await screen.findByRole("list", { name: "Pay rates for Ann" });
    expect(list).toHaveTextContent("$20.00/h");
    expect(list).toHaveTextContent("From Jun 10, 2026");
    expect(list).toHaveTextContent("$25.00/h · Shift Lead");
    expect(list).toHaveTextContent("Since the start");
  });

  it("adds a dated raise, and a position rate", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann", pay_rate: 20 }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    await screen.findByRole("list", { name: "Pay rates for Ann" });
    fireEvent.change(screen.getByLabelText("New hourly rate for Ann"), { target: { value: "21.75" } });
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rate" }));
    await waitFor(() => expect(body(fetchMock, "POST", "/api/employees/7/pay-rates")).toEqual({ hourlyRate: 21.75, effectiveFrom: "2026-07-01", positionId: null }));
    // A future raise doesn't change today's rate.
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New hourly rate for Ann"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rate" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(i.body))[1])
        .toEqual({ hourlyRate: 30, effectiveFrom: "2026-07-01", positionId: 5 })
    );
  });

  it("refuses a malformed rate without sending it", async () => {
    const fetchMock = mockFetch();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann" }} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    await screen.findByRole("list", { name: "Pay rates for Ann" });
    fireEvent.change(screen.getByLabelText("New hourly rate for Ann"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a rate like 18.50.");
    expect(body(fetchMock, "POST", "/pay-rates")).toBeUndefined();
  });

  it("shows the server's error", async () => {
    mockFetch({ postOk: false, postBody: { error: "Position not found" } });
    render(<EmployeePayRow employee={{ id: 7, name: "Ann" }} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    await screen.findByRole("list", { name: "Pay rates for Ann" });
    fireEvent.change(screen.getByLabelText("New hourly rate for Ann"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rate" }));
    expect(await screen.findByText("Position not found")).toBeInTheDocument();
  });

  it("saves the payroll ID through PATCH /api/employees", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(<EmployeePayRow employee={{ id: 7, name: "Ann" }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    fireEvent.change(screen.getByLabelText("Payroll ID"), { target: { value: " ADP-9 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ payroll_id: "ADP-9" }));
    expect(body(fetchMock, "PATCH", "/api/employees")).toEqual({ id: 7, payrollId: "ADP-9" });
  });
});

describe("helpers", () => {
  it("parses rates in dollars and cents", () => {
    expect(parseRate("18.5")).toBe(18.5);
    expect(parseRate("$20")).toBe(20);
    expect(parseRate("")).toBeNull();
    expect(parseRate("1.234")).toBe("invalid");
    expect(parseRate("-1")).toBe("invalid");
    expect(parseRate("abc")).toBe("invalid");
  });

  it("shows the migrated rate as since the start", () => {
    expect(fmtEffective("1900-01-01", "1900-01-01")).toBe("Since the start");
    expect(fmtEffective("2026-03-08", "1900-01-01")).toBe("From Mar 8, 2026");
  });
});
