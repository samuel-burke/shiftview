import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShiftPreferencesSection from "./ShiftPreferencesSection";

const SAVED = {
  employeeId: 7,
  preferredShiftTypes: ["opener"],
  preferredDays: [1],
  avoidDays: [0],
  desiredWeeklyHours: 24,
  note: null,
  updatedAt: "2026-10-01T12:00:00Z",
};

function mockFetch({ getOk = true, putOk = true } = {}) {
  const fn = vi.fn().mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") return { ok: getOk, json: async () => SAVED };
    const body = JSON.parse(String(init?.body));
    return { ok: putOk, json: async () => ({ ...SAVED, ...body, updatedAt: "2026-10-02T12:00:00Z" }) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("ShiftPreferencesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and shows the saved preferences", async () => {
    const fetchMock = mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={1} />);
    expect(await screen.findByRole("button", { name: "Prefer opening shifts" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/preferences?employeeId=7");
    expect(screen.getByRole("button", { name: "Prefer closing shifts" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Prefer Mondays" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rather not work Sundays" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Hours I'd like each week")).toHaveValue(24);
  });

  it("orders days from the store's first day of week", async () => {
    mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={1} />);
    await screen.findByRole("button", { name: "Prefer Mondays" });
    const labels = screen.getAllByRole("button", { name: /^Prefer \w+days$/ }).map((b) => b.textContent);
    expect(labels).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("keeps a day out of both lists at once", async () => {
    mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} />);
    const avoidMonday = await screen.findByRole("button", { name: "Rather not work Mondays" });
    fireEvent.click(avoidMonday);
    expect(avoidMonday).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Prefer Mondays" })).toHaveAttribute("aria-pressed", "false");
  });

  it("saves only once something changed", async () => {
    const fetchMock = mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} />);
    const save = await screen.findByRole("button", { name: "Save Preferences" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Prefer closing shifts" }));
    fireEvent.change(screen.getByLabelText("Hours I'd like each week"), { target: { value: "20.5" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await screen.findByText("Saved ✓");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/preferences");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      employeeId: 7,
      preferredShiftTypes: ["opener", "closer"],
      preferredDays: [1],
      avoidDays: [0],
      desiredWeeklyHours: 20.5,
      note: null,
    });
    expect(save).toBeDisabled();
  });

  it("rejects weekly hours that aren't whole or half hours", async () => {
    const fetchMock = mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} />);
    fireEvent.change(await screen.findByLabelText("Hours I'd like each week"), { target: { value: "20.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
    expect(screen.getByRole("alert")).toHaveTextContent("whole or half hours");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error when saving fails", async () => {
    mockFetch({ putOk: false });
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Prefer mid-day shifts" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });

  it("says so when preferences can't be loaded", async () => {
    mockFetch({ getOk: false });
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} />);
    expect(await screen.findByText(/aren't available right now/)).toBeInTheDocument();
  });

  it("phrases labels for a manager editing someone else", async () => {
    mockFetch();
    render(<ShiftPreferencesSection employeeId={7} firstDayOfWeek={0} employeeName="Sam Kim" embedded />);
    expect(await screen.findByText("Shifts they like")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Sam Kim's shift preferences" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Hours they'd like each week")).toHaveValue(24));
  });
});
