import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AvailabilitySection from "./AvailabilitySection";

// ── Mock fetch globally ──────────────────────────────────────────────────────

function makeMockFetch(records: any[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(records),
  });
}

const WEEKLY_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

const BASE_PROPS = {
  employeeId: 1,
  weeklyHours: WEEKLY_HOURS,
  firstDayOfWeek: 0, // Sun first
};

describe("AvailabilitySection", () => {
  it("renders all 7 days", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const d of dayNames) {
      expect(screen.getAllByText(d).length).toBeGreaterThan(0);
    }
  });

  it("days render in firstDayOfWeek order (Mon first when firstDayOfWeek=1)", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} firstDayOfWeek={1} />);
    await act(async () => { await Promise.resolve(); });
    const dayLabels = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/).map((el) => el.textContent);
    expect(dayLabels[0]).toBe("Mon");
    expect(dayLabels[6]).toBe("Sun");
  });

  it("fetches availability on mount", async () => {
    const mockFetch = makeMockFetch([]);
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/availability?employeeId=1"));
  });

  it("shows 'Any time' as default for days with no record", async () => {
    vi.stubGlobal("fetch", makeMockFetch([]));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    // All 7 days should show "Any time" as active
    const anyButtons = screen.getAllByRole("button", { name: "Any time" });
    expect(anyButtons.length).toBe(7);
  });

  it("shows 'Off' pill active for days with null-window records", async () => {
    const records = [{ id: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    // Monday (day 1) should have "Off" active
    const offButtons = screen.getAllByRole("button", { name: "Off" });
    const activeOff = offButtons.find((b) => b.getAttribute("aria-pressed") === "true");
    expect(activeOff).toBeTruthy();
  });

  it("shows 'Window' pill active for days with time-window records", async () => {
    const records = [{ id: 2, dayOfWeek: 3, startMinutes: 720, endMinutes: 1320, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });
    const windowButtons = screen.getAllByRole("button", { name: "Window" });
    const activeWindow = windowButtons.find((b) => b.getAttribute("aria-pressed") === "true");
    expect(activeWindow).toBeTruthy();
  });

  it("clicking 'Off' fires POST and updates state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // GET on mount
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) }); // POST
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    // Click "Off" on first day (Sun = day 0)
    const offButtons = screen.getAllByRole("button", { name: "Off" });
    await act(async () => { fireEvent.click(offButtons[0]); });

    // Advance timers to trigger the debounced save
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/availability", expect.objectContaining({
      method: "POST",
    }));
    vi.useRealTimers();
  });

  it("clicking 'Any time' on an 'Off' day fires DELETE and clears state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const records = [{ id: 5, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: null }];
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(records) }) // GET on mount
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) }); // DELETE
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    // Click "Any time" on Sun (first day, which is off)
    const anyButtons = screen.getAllByRole("button", { name: "Any time" });
    await act(async () => { fireEvent.click(anyButtons[0]); });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/availability", expect.objectContaining({
      method: "DELETE",
    }));
    vi.useRealTimers();
  });

  it("'+ Add note' expands note input", async () => {
    const records = [{ id: 1, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    const addNoteBtn = screen.getAllByText("+ Add note")[0];
    await act(async () => { fireEvent.click(addNoteBtn); });

    expect(screen.getAllByPlaceholderText("Add a note…").length).toBeGreaterThan(0);
  });

  it("'Copy to Weekdays' copies window to Mon-Fri days", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    // First set Sun to window state
    const windowButtons = screen.getAllByRole("button", { name: "Window" });
    await act(async () => { fireEvent.click(windowButtons[0]); }); // Sun

    // Now click "Copy to: Weekdays"
    const copyBtn = screen.getByRole("button", { name: "Weekdays" });
    await act(async () => { fireEvent.click(copyBtn); });

    // Mon-Fri should now have Window state active
    await act(async () => { vi.advanceTimersByTime(100); await Promise.resolve(); });

    // All Window buttons for weekdays should have aria-pressed="true"
    const allWindowButtons = screen.getAllByRole("button", { name: "Window" });
    const activePressedWindows = allWindowButtons.filter((b) => b.getAttribute("aria-pressed") === "true");
    // At minimum Mon-Fri + Sun = 6 active window buttons
    expect(activePressedWindows.length).toBeGreaterThanOrEqual(6);
    vi.useRealTimers();
  });

  it("shows visual bar for saved window rows", async () => {
    const records = [{ id: 2, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320, note: null }];
    vi.stubGlobal("fetch", makeMockFetch(records));
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    // The bar should be visible (saveStatus is "saved" by default for window records from API)
    expect(screen.getAllByLabelText("availability bar").length).toBeGreaterThan(0);
  });

  it("shows 'Saved ✓' status indicator after successful save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    const offButtons = screen.getAllByRole("button", { name: "Off" });
    await act(async () => { fireEvent.click(offButtons[0]); });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText("Saved ✓").length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("shows error status on failed save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "DB error" }) });
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} />);
    await act(async () => { await Promise.resolve(); });

    const offButtons = screen.getAllByRole("button", { name: "Off" });
    await act(async () => { fireEvent.click(offButtons[0]); });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("demo mode: no API calls fired, state updates locally", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    render(<AvailabilitySection {...BASE_PROPS} isDemo={true} />);
    await act(async () => { await Promise.resolve(); });

    const offButtons = screen.getAllByRole("button", { name: "Off" });
    await act(async () => { fireEvent.click(offButtons[0]); });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // No fetch calls made
    expect(mockFetch).not.toHaveBeenCalled();
    // State should still update locally
    const allOffButtons = screen.getAllByRole("button", { name: "Off" });
    const activeOff = allOffButtons.find((b) => b.getAttribute("aria-pressed") === "true");
    expect(activeOff).toBeTruthy();
    vi.useRealTimers();
  });
});
