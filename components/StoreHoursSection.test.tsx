import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import StoreHoursSection from "./StoreHoursSection";

const FETCHED_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480,  close: 1200 }, // Sun  8:00 AM – 8:00 PM
  1: { open: 360,  close: 1320 }, // Mon  6:00 AM – 10:00 PM
  2: { open: 360,  close: 1320 },
  3: { open: 360,  close: 1320 },
  4: { open: 360,  close: 1320 },
  5: { open: 360,  close: 1320 },
  6: { open: 360,  close: 1320 },
};

function makeMockFetch(putOk = true) {
  return vi.fn().mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/store-hours") && method === "GET")
      return { ok: true, json: async () => FETCHED_HOURS };
    return { ok: putOk, json: async () => ({}) };
  });
}

async function openSheet(dow: number) {
  const row = screen.getByTestId(`day-row-${dow}`);
  await act(async () => { fireEvent.click(row); });
  await act(async () => { await Promise.resolve(); });
}

describe("StoreHoursSection", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Rendering ────────────────────────────────────────────────────────────

  it("fetches store hours on mount", async () => {
    const mockFetch = makeMockFetch();
    vi.stubGlobal("fetch", mockFetch);
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/store-hours"));
  });

  it("renders all 7 day rows", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`day-row-${i}`)).toBeInTheDocument();
    }
  });

  it("renders day labels Sun–Sat", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");
    for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(d)).toBeInTheDocument();
    }
  });

  it("renders days in firstDayOfWeek order (Mon first when firstDayOfWeek=1)", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection firstDayOfWeek={1} />);
    await screen.findByTestId("day-row-1");
    const rows = screen.getAllByTestId(/^day-row-/);
    expect(rows[0].textContent).toMatch(/Mon/);
    expect(rows[6].textContent).toMatch(/Sun/);
  });

  it("shows formatted open–close time in each row after fetch", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");
    // Sun: 480=8:00 AM, 1200=8:00 PM
    expect(screen.getByTestId("day-row-0").textContent).toMatch(/8:00 AM/);
    expect(screen.getByTestId("day-row-0").textContent).toMatch(/8:00 PM/);
  });

  // ── Bottom sheet open / close ─────────────────────────────────────────────

  it("tapping a row opens the bottom sheet", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    expect(screen.queryByTestId("store-hours-sheet")).not.toBeInTheDocument();
    await openSheet(0);
    expect(screen.getByTestId("store-hours-sheet")).toBeInTheDocument();
  });

  it("sheet shows the correct day name", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(3); // Wed
    expect(screen.getByText("Wednesday")).toBeInTheDocument();
  });

  it("close button (✕) dismisses the sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("store-hours-sheet")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("backdrop click dismisses the sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", makeMockFetch());
    const { container } = render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    const backdrop = container.querySelector(".fixed.inset-0.bg-black\\/60") as HTMLElement;
    expect(backdrop).toBeTruthy();
    await act(async () => {
      fireEvent.click(backdrop);
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("store-hours-sheet")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Time inputs inside the sheet ──────────────────────────────────────────

  it("sheet has Open and Close inputs prefilled with fetched times", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(0); // Sun: open=480 (08:00), close=1200 (20:00)
    expect((screen.getByLabelText("Sunday open time") as HTMLInputElement).value).toBe("08:00");
    expect((screen.getByLabelText("Sunday close time") as HTMLInputElement).value).toBe("20:00");
  });

  it("blurring the Open input fires PUT /api/store-hours with correct openMinutes", async () => {
    const mockFetch = makeMockFetch();
    vi.stubGlobal("fetch", mockFetch);
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    const input = screen.getByLabelText("Sunday open time");
    await act(async () => {
      fireEvent.change(input, { target: { value: "09:00" } });
      fireEvent.blur(input);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === "/api/store-hours" && (call[1] as RequestInit | undefined)?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall![1].body as string);
      expect(body.dayOfWeek).toBe(0);
      expect(body.openMinutes).toBe(540); // 9*60
    });
  });

  it("blurring the Close input fires PUT /api/store-hours with correct closeMinutes", async () => {
    const mockFetch = makeMockFetch();
    vi.stubGlobal("fetch", mockFetch);
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-1");

    await openSheet(1);
    const input = screen.getByLabelText("Monday close time");
    await act(async () => {
      fireEvent.change(input, { target: { value: "21:00" } });
      fireEvent.blur(input);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (call: any[]) =>
          call[0] === "/api/store-hours" && (call[1] as RequestInit | undefined)?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall![1].body as string);
      expect(body.dayOfWeek).toBe(1);
      expect(body.closeMinutes).toBe(1260); // 21*60
    });
  });

  it("shows 'Saved ✓' in sheet after successful save", async () => {
    const mockFetch = makeMockFetch(true);
    vi.stubGlobal("fetch", mockFetch);
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    const input = screen.getByLabelText("Sunday open time");
    await act(async () => {
      fireEvent.change(input, { target: { value: "09:00" } });
      fireEvent.blur(input);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("store-hours-sheet").textContent).toMatch(/Saved/);
    });
  });

  it("shows 'Failed to save' in sheet on API error", async () => {
    vi.stubGlobal("fetch", makeMockFetch(false));
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    const input = screen.getByLabelText("Sunday open time");
    await act(async () => {
      fireEvent.change(input, { target: { value: "09:00" } });
      fireEvent.blur(input);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("store-hours-sheet").textContent).toMatch(/Failed/);
    });
  });

  it("shows validation error when close time is before open time", async () => {
    vi.stubGlobal("fetch", makeMockFetch());
    render(<StoreHoursSection />);
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Sunday open time"),  { target: { value: "20:00" } });
      fireEvent.change(screen.getByLabelText("Sunday close time"), { target: { value: "08:00" } });
    });

    expect(screen.getByText(/close time must be after open time/i)).toBeInTheDocument();
  });

  // ── Copy buttons ──────────────────────────────────────────────────────────

  it("'Weekdays' button copies hours to Mon–Fri rows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => FETCHED_HOURS }));
    render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });

    // Set Sunday to 9am-5pm then open sheet and copy
    await openSheet(0);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Sunday open time"),  { target: { value: "09:00" } });
      fireEvent.change(screen.getByLabelText("Sunday close time"), { target: { value: "17:00" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Weekdays" }));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    // Mon–Fri rows should reflect 9:00 AM – 5:00 PM
    for (let dow = 1; dow <= 5; dow++) {
      expect(screen.getByTestId(`day-row-${dow}`).textContent).toMatch(/9:00 AM/);
      expect(screen.getByTestId(`day-row-${dow}`).textContent).toMatch(/5:00 PM/);
    }
    vi.useRealTimers();
  });

  it("'Weekends' button copies hours to Sat and Sun rows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => FETCHED_HOURS }));
    render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(1); // Mon sheet
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Monday open time"),  { target: { value: "10:00" } });
      fireEvent.change(screen.getByLabelText("Monday close time"), { target: { value: "18:00" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Weekends" }));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(screen.getByTestId("day-row-0").textContent).toMatch(/10:00 AM/);
    expect(screen.getByTestId("day-row-6").textContent).toMatch(/10:00 AM/);
    vi.useRealTimers();
  });

  it("'All days' button copies hours to all other rows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => FETCHED_HOURS }));
    render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Sunday open time"),  { target: { value: "07:00" } });
      fireEvent.change(screen.getByLabelText("Sunday close time"), { target: { value: "23:00" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "All days" }));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    for (let dow = 1; dow < 7; dow++) {
      expect(screen.getByTestId(`day-row-${dow}`).textContent).toMatch(/7:00 AM/);
      expect(screen.getByTestId(`day-row-${dow}`).textContent).toMatch(/11:00 PM/);
    }
    vi.useRealTimers();
  });

  it("copy button shows '✓ Weekdays updated' for 2 s then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => FETCHED_HOURS }));
    render(<StoreHoursSection />);
    await act(async () => { await Promise.resolve(); });

    await openSheet(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Weekdays" }));
    });
    expect(screen.getByText("✓ Weekdays updated")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("✓ Weekdays updated")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weekdays" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Demo mode ─────────────────────────────────────────────────────────────

  it("demo mode: no API calls, shows 'Saved ✓' after blur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    render(<StoreHoursSection isDemo={true} />);
    await screen.findByTestId("day-row-0");

    await openSheet(0);
    const input = screen.getByLabelText("Sunday open time");
    await act(async () => {
      fireEvent.change(input, { target: { value: "09:00" } });
      fireEvent.blur(input);
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("store-hours-sheet").textContent).toMatch(/Saved/);
    });
    vi.useRealTimers();
  });
});
