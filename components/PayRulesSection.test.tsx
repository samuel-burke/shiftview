import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import PayRulesSection from "./PayRulesSection";
import EmployeeExemptToggle from "./EmployeeExemptToggle";
import { DEFAULT_PAY_RULES, type PayRules } from "@/lib/pay-rules";

function mockFetch(ok = true, body: unknown = { ok: true }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const sentBody = (m: ReturnType<typeof mockFetch>, i = 0) => JSON.parse(String(m.mock.calls[i][1]!.body));

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = DEFAULT_PAY_RULES }: { initial?: PayRules }) {
  const [rules, setRules] = useState(initial);
  return <PayRulesSection rules={rules} onSaved={setRules} />;
}

describe("PayRulesSection", () => {
  it("shows the defaults: federal, Monday, rounding off", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Overtime rule")).toHaveValue("federal");
    expect(screen.getByLabelText("Payroll workweek starts")).toHaveValue("1");
    expect(screen.getByLabelText("Punch rounding")).toHaveValue("0");
    expect(screen.queryByRole("switch", { name: "Nevada daily overtime" })).not.toBeInTheDocument();
  });

  it("saves the overtime rule and explains it", async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Overtime rule"), { target: { value: "california" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings");
    expect(sentBody(fetchMock)).toEqual({ payRules: { overtimeRule: "california" } });
    expect(screen.getByTestId("overtime-rule-desc")).toHaveTextContent(/double time after 12 h/);
  });

  it("offers Nevada's daily overtime flag only under Nevada", async () => {
    const fetchMock = mockFetch();
    render(<Harness initial={{ ...DEFAULT_PAY_RULES, overtimeRule: "nevada" }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Nevada daily overtime" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ payRules: { nevadaDailyOvertime: true } });
  });

  it("warns about changing the workweek and asks before saving it", async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    expect(screen.getByTestId("workweek-warning")).toHaveTextContent(/never to avoid paying overtime/);
    fireEvent.change(screen.getByLabelText("Payroll workweek starts"), { target: { value: "0" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Start the payroll workweek on Sunday instead of Monday?");
    fireEvent.click(screen.getByRole("button", { name: "Change workweek" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ payRules: { workweekStartDay: 0 } });
    expect(screen.getByLabelText("Payroll workweek starts")).toHaveValue("0");
  });

  it("cancels a workweek change without saving", () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Payroll workweek starts"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Payroll workweek starts")).toHaveValue("1");
  });

  it("saves rounding and says exact time is safest", async () => {
    const fetchMock = mockFetch();
    render(<Harness />);
    expect(screen.getByText(/must be neutral/)).toBeInTheDocument();
    expect(screen.getByText(/exact time is the safest/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Punch rounding"), { target: { value: "15" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ payRules: { roundingMinutes: 15 } });
  });

  it("puts the old value back when saving fails", async () => {
    mockFetch(false, { error: "overtimeRule must be one of …" });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Overtime rule"), { target: { value: "colorado" } });
    expect(await screen.findByText("overtimeRule must be one of …")).toBeInTheDocument();
    expect(screen.getByLabelText("Overtime rule")).toHaveValue("federal");
  });
});

describe("EmployeeExemptToggle", () => {
  it("marks an employee exempt", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(<EmployeeExemptToggle employee={{ id: 4, name: "Kim", exempt: false }} onSaved={onSaved} />);
    const sw = screen.getByRole("switch", { name: "Exempt from overtime: Kim" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/employees");
    expect(sentBody(fetchMock)).toEqual({ id: 4, exempt: true });
  });

  it("clears it, and reports a failure", async () => {
    mockFetch(false);
    const onSaved = vi.fn();
    render(<EmployeeExemptToggle employee={{ id: 4, name: "Kim", exempt: true }} onSaved={onSaved} />);
    expect(screen.getByText(/no overtime is calculated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
