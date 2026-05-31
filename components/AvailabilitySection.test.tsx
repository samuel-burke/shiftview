import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import AvailabilitySection from "./AvailabilitySection";

function makeMockFetch(records: any[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(records),
  });
}

const WEEKLY_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480,  close: 1200 },
  1: { open: 360,  close: 1320 },
  2: { open: 360,  close: 1320 },
  3: { open: 360,  close: 1320 },
  4: { open: 360,  close: 1320 },
  5: { open: 360,  close: 1320 },
  6: { open: 360,  close: 1320 },
};

const BASE_PROPS = {
  employeeId: 1,
  weeklyHours: WEEKLY_HOURS,
  firstDayOfWeek: 0, // Sun first
};

// Helper: click a day row to open its bottom sheet
async function openSheet(dow: number) {
  const row = screen.getByTestId(`day-row-${dow}`);
  await act(async () => { fireEvent.click(row); });
  await act(async () => { await Promise.resolve(); });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("AvailabilitySection", () => {
  it("renders all 7 day labels", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(d)).toBeInTheDocument();
    }
  });

  it("renders days in firstDayOfWeek order (Mon first when firstDayOfWeek=1)", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} firstDayOfWeek={1} />);
    await act(async () => { await Promise.resolve(); });
    const rows = screen.getAllByTestId(/^day-row-/);
    // first row should be Mon (dow=1), last should be Sun (dow=0)
    expect(rows[0].textContent).toMatch(/Mon/);
    expect(rows[6].textContent).toMatch(/Sun/);
  });

  it("fetches availability on mount", async () => {
    const mockFetch = makeMockFetch([]);
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/availability?employeeId=1"));
  });

  it("shows 'Any time' summary in each row when no records", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText("Any time").length).toBe(7);
  });

  it("shows 'Off' summary in the row for a null-window record", async () => {
    const records = [{ id: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows formatted time range in the row for a window record", async () => {
    const records = [{ id: 2, dayOfWeek: 3, startMinutes: 720, endMinutes: 1320, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    // fmtMinutes(720)="12:00 PM", fmtMinutes(1320)="10:00 PM"
    expect(screen.getByText(/12:00 PM – 10:00 PM/)).toBeInTheDocument();
  });

  // ── Bottom sheet ─────────────────────────────────────────────────────────────

  it("tapping a day row opens the bottom sheet for that day", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId("availability-sheet")).not.toBeInTheDocument();
    await openSheet(0); // Sun
    expect(screen.getByTestId("availability-sheet")).toBeInTheDocument();
    expect(screen.getByText("Sunday")).toBeInTheDocument();
  });

  it("sheet shows correct day name when opened", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(3); // Wed
    expect(screen.getByText("Wednesday")).toBeInTheDocument();
  });

  it("sheet shows the current state pre-selected", async () => {
    const records = [{ id: 1, dayOfWeek: 2, startMinutes: null, endMinutes: null, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(2); // Tue — should be "off"
    const offBtn = screen.getByRole("button", { name: "Off" });
    expect(offBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("close button (✕) dismisses the sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    expect(screen.getByTestId("availability-sheet")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByTestId("availability-sheet")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("backdrop click dismisses the sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", makeMockFetch([]));
    const { container } = render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    // backdrop is the div immediately before the sheet panel (fixed inset-0)
    const backdrop = container.querySelector(".fixed.inset-0.bg-black\\/60") as HTMLElement;
    expect(backdrop).toBeTruthy();
    await act(async () => {
      fireEvent.click(backdrop);
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByTestId("availability-sheet")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Pill interactions (inside sheet) ─────────────────────────────────────────

  it("clicking 'Off' in sheet fires POST with null times", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })          // GET
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) }); // POST
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0); // Sun
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Off" })); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });

    expect(mockFetch).toHaveBeenCalledWith("/api/availability", expect.objectContaining({ method: "POST" }));
    vi.useRealTimers();
  });

  it("clicking 'Any time' on an 'Off' day fires DELETE", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const records = [{ id: 5, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: null }];
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(records) })       // GET
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) }); // DELETE
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0); // Sun (which is "off")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Any time" })); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });

    expect(mockFetch).toHaveBeenCalledWith("/api/availability", expect.objectContaining({ method: "DELETE" }));
    vi.useRealTimers();
  });

  it("shows 'Saved ✓' in sheet after successful save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Off" })); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByText("Saved ✓")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows 'Failed to save' in sheet on API error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "DB error" }) });
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Off" })); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByText("Failed to save")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("'Copy to Weekdays' copies window to Mon–Fri rows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    // Open Sun, set to Window, then copy to Weekdays
    await openSheet(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Window" })); });
    const copyBtn = screen.getByRole("button", { name: "Weekdays" });
    await act(async () => { fireEvent.click(copyBtn); vi.advanceTimersByTime(100); await Promise.resolve(); });

    // Mon–Fri rows should now show a time range (not "Any time")
    const anyTimeEls = screen.getAllByText("Any time");
    // Only Sat (1 day) should remain "Any time"; Mon–Fri + Sun = 6 have Window
    expect(anyTimeEls.length).toBeLessThanOrEqual(2);
    vi.useRealTimers();
  });

  it("copy button shows '✓ Weekdays updated' confirmation for 2s then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Window" })); });

    // Click Weekdays
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Weekdays" })); });
    expect(screen.getByText("✓ Weekdays updated")).toBeInTheDocument();

    // After 2s timer fires, label reverts
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("✓ Weekdays updated")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weekdays" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows visual availability bar in sheet for a saved window record", async () => {
    const records = [{ id: 2, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(1); // Mon
    expect(screen.getByLabelText("availability bar")).toBeInTheDocument();
  });

  it("demo mode: no API calls fired, state updates locally", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} isDemo={true} />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Off" })); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });

    expect(mockFetch).not.toHaveBeenCalled();
    // State still updates locally
    expect(screen.getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true");
    vi.useRealTimers();
  });
});
