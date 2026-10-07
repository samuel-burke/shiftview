import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmployeeSchedulingRow from "./EmployeeSchedulingRow";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";

const EMPTY_PREFS = {
  employeeId: 3, preferredShiftTypes: [], preferredDays: [], avoidDays: [],
  desiredWeeklyHours: null, note: null, updatedAt: null,
};

function mockFetch(patchOk = true, patchBody: unknown = { ok: true }) {
  const fn = vi.fn().mockImplementation(async (input: RequestInfo) => {
    const url = input.toString();
    if (url.startsWith("/api/preferences")) return { ok: true, json: async () => EMPTY_PREFS };
    return { ok: patchOk, json: async () => patchBody };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function patchCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/employees");
  return call ? JSON.parse(call[1].body) : undefined;
}

describe("EmployeeSchedulingRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flags an employee without an employment type", () => {
    render(
      <EmployeeSchedulingRow employee={{ id: 3, name: "Alex Rivera" }} rules={DEFAULT_SCHEDULING_RULES} firstDayOfWeek={0} onSaved={() => {}} />
    );
    expect(screen.getByText("Employment type not set")).toBeInTheDocument();
  });

  it("summarizes a full-timer's limits, falling back to the defaults", () => {
    render(
      <EmployeeSchedulingRow
        employee={{ id: 3, name: "Alex Rivera", employment_type: "full_time", max_weekly_hours: 38 }}
        rules={DEFAULT_SCHEDULING_RULES}
        firstDayOfWeek={0}
        onSaved={() => {}}
      />
    );
    expect(screen.getByText("Full-time · 32–38 h · up to 5 days")).toBeInTheDocument();
  });

  it("saves employment type and limits", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(
      <EmployeeSchedulingRow employee={{ id: 3, name: "Alex Rivera" }} rules={DEFAULT_SCHEDULING_RULES} firstDayOfWeek={0} onSaved={onSaved} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Scheduling for Alex Rivera" }));
    fireEvent.click(screen.getByRole("radio", { name: "Part-time" }));
    // Blank hours show the part-time defaults as placeholders.
    expect(screen.getByLabelText("Maximum weekly hours for Alex Rivera")).toHaveAttribute("placeholder", "29");
    fireEvent.change(screen.getByLabelText("Maximum weekly hours for Alex Rivera"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Most days per week for Alex Rivera"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Limits" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patchCall(fetchMock)).toEqual({
      id: 3, employmentType: "part_time", minWeeklyHours: null, maxWeeklyHours: 20, maxDaysPerWeek: 3,
    });
    expect(onSaved).toHaveBeenCalledWith({
      employment_type: "part_time", min_weekly_hours: null, max_weekly_hours: 20, max_days_per_week: 3,
    });
  });

  it("refuses a minimum above the maximum", () => {
    const fetchMock = mockFetch();
    render(
      <EmployeeSchedulingRow employee={{ id: 3, name: "Alex Rivera" }} rules={DEFAULT_SCHEDULING_RULES} firstDayOfWeek={0} onSaved={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Scheduling for Alex Rivera" }));
    fireEvent.change(screen.getByLabelText("Minimum weekly hours for Alex Rivera"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Maximum weekly hours for Alex Rivera"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Limits" }));
    expect(screen.getByRole("alert")).toHaveTextContent("minimum can't be more than the maximum");
    expect(patchCall(fetchMock)).toBeUndefined();
  });

  it("shows the server's reason when saving fails", async () => {
    mockFetch(false, { error: "minWeeklyHours cannot exceed maxWeeklyHours" });
    render(
      <EmployeeSchedulingRow employee={{ id: 3, name: "Alex Rivera" }} rules={DEFAULT_SCHEDULING_RULES} firstDayOfWeek={0} onSaved={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Scheduling for Alex Rivera" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Limits" }));
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
    expect(screen.getByText("minWeeklyHours cannot exceed maxWeeklyHours")).toBeInTheDocument();
  });

  it("includes the employee's shift preferences when expanded", async () => {
    mockFetch();
    render(
      <EmployeeSchedulingRow employee={{ id: 3, name: "Alex Rivera" }} rules={DEFAULT_SCHEDULING_RULES} firstDayOfWeek={0} onSaved={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Scheduling for Alex Rivera" }));
    expect(await screen.findByRole("group", { name: "Alex Rivera's shift preferences" })).toBeInTheDocument();
  });
});
