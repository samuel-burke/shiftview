import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PayPeriodSection from "./PayPeriodSection";

function mockFetch(ok = true, json: unknown = {}) {
  const fn = vi.fn().mockResolvedValue({ ok, json: async () => json });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body).payPeriod;

describe("PayPeriodSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is off by default and says payroll is any range", () => {
    render(<PayPeriodSection value={{ frequency: "none", anchor: null }} todayKey="2026-10-18" onChange={() => {}} />);
    expect(screen.getByLabelText("Pay period")).toHaveValue("none");
    expect(screen.queryByLabelText("First day of a pay period")).toBeNull();
    expect(screen.getByTestId("pay-period-current")).toHaveTextContent(/any dates/);
  });

  it("shows the current period", () => {
    render(<PayPeriodSection value={{ frequency: "semimonthly", anchor: null }} todayKey="2026-10-18" onChange={() => {}} />);
    expect(screen.getByTestId("pay-period-current")).toHaveTextContent("Fri, Oct 16, 2026 – Sat, Oct 31, 2026");
  });

  it("saves weekly straight away", async () => {
    const fetchMock = mockFetch();
    const onChange = vi.fn();
    render(<PayPeriodSection value={{ frequency: "none", anchor: null }} todayKey="2026-10-18" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Pay period"), { target: { value: "weekly" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ frequency: "weekly", anchor: null }));
    expect(sent(fetchMock)).toEqual({ frequency: "weekly", anchor: null });
  });

  it("waits for a first day before saving biweekly", async () => {
    const fetchMock = mockFetch();
    const onChange = vi.fn();
    render(<PayPeriodSection value={{ frequency: "none", anchor: null }} todayKey="2026-10-18" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Pay period"), { target: { value: "biweekly" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/first day/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("First day of a pay period"), { target: { value: "2026-09-28" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ frequency: "biweekly", anchor: "2026-09-28" }));
    expect(sent(fetchMock)).toEqual({ frequency: "biweekly", anchor: "2026-09-28" });
  });

  it("shows the server's reason when saving fails", async () => {
    mockFetch(false, { error: "Biweekly pay periods need payPeriod.anchor" });
    const onChange = vi.fn();
    render(<PayPeriodSection value={{ frequency: "weekly", anchor: null }} todayKey="2026-10-18" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Pay period"), { target: { value: "semimonthly" } });
    expect(await screen.findByText("Biweekly pay periods need payPeriod.anchor")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
