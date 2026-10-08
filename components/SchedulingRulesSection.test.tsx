import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SchedulingRulesSection from "./SchedulingRulesSection";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";

function mockFetch(ok = true) {
  const fn = vi.fn().mockResolvedValue({ ok, json: async () => ({}) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function sentPatch(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body).schedulingRules;
}

describe("SchedulingRulesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the current rules", () => {
    render(<SchedulingRulesSection rules={DEFAULT_SCHEDULING_RULES} onSaved={() => {}} />);
    expect(screen.getByLabelText("Shortest shift")).toHaveValue("240");
    expect(screen.getByLabelText("Longest shift")).toHaveValue("480");
    expect(screen.getByLabelText("Minimum rest between shifts")).toHaveValue("600");
    expect(screen.getByRole("radio", { name: "Never" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Part-Time maximum weekly hours")).toHaveValue(29);
  });

  it("only offers a longest shift at or above the shortest", () => {
    render(<SchedulingRulesSection rules={{ ...DEFAULT_SCHEDULING_RULES, minShiftMinutes: 360 }} onSaved={() => {}} />);
    const options = Array.from((screen.getByLabelText("Longest shift") as HTMLSelectElement).options).map((o) => Number(o.value));
    expect(Math.min(...options)).toBe(360);
  });

  it("saves a changed rule as a patch and reports it", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(<SchedulingRulesSection rules={DEFAULT_SCHEDULING_RULES} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("radio", { name: "To fill gaps" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" }));
    expect(sentPatch(fetchMock)).toEqual({ overtimePolicy: "when_needed" });
    expect(onSaved.mock.calls[0][0].overtimePolicy).toBe("when_needed");
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("saves weekly hours when the field loses focus", async () => {
    const fetchMock = mockFetch();
    render(<SchedulingRulesSection rules={DEFAULT_SCHEDULING_RULES} onSaved={() => {}} />);
    const input = screen.getByLabelText("Part-Time maximum weekly hours");
    fireEvent.change(input, { target: { value: "24.5" } });
    fireEvent.blur(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentPatch(fetchMock)).toEqual({ partTimeMaxHours: 24.5 });
  });

  it("refuses a minimum above the maximum without saving", () => {
    const fetchMock = mockFetch();
    render(<SchedulingRulesSection rules={DEFAULT_SCHEDULING_RULES} onSaved={() => {}} />);
    const input = screen.getByLabelText("Full-Time minimum weekly hours");
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("minimum hours can't be more than the maximum");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reverts and shows an error when saving fails", async () => {
    mockFetch(false);
    const onSaved = vi.fn();
    render(<SchedulingRulesSection rules={DEFAULT_SCHEDULING_RULES} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Most consecutive working days"), { target: { value: "5" } });
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
    expect(screen.getByLabelText("Most consecutive working days")).toHaveValue("6");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
