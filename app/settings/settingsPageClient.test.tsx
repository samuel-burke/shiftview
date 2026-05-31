import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPageClient from "./settingsPageClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

const DEFAULT_HOURS = {
  0: { open: 480,  close: 1200 },
  1: { open: 360,  close: 1320 },
  2: { open: 360,  close: 1320 },
  3: { open: 360,  close: 1320 },
  4: { open: 360,  close: 1320 },
  5: { open: 360,  close: 1320 },
  6: { open: 360,  close: 1320 },
};

const DEFAULT_SETTINGS = {
  firstDayOfWeek: 0,
  optimalCoverage: 3,
  minCoverage: 2,
  timezone: "America/New_York",
  emailNotifications: false,
};

function setupFetch({ putOk = true } = {}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET") {
      if (url.includes("/api/store-hours"))
        return { ok: true, json: async () => DEFAULT_HOURS } as Response;
      if (url.includes("/api/settings"))
        return { ok: true, json: async () => DEFAULT_SETTINGS } as Response;
      if (url.includes("/api/employees"))
        return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/me"))
        return { ok: true, json: async () => ({ isManager: false }) } as Response;
      if (url.includes("/api/availability"))
        return { ok: true, json: async () => [] } as Response;
    }

    return { ok: putOk, json: async () => ({}) } as Response;
  });
}

async function renderAndSettle() {
  render(<SettingsPageClient />);
  // Wait for store hours inputs to appear (signals initial fetches resolved)
  await screen.findByLabelText("Sunday open time");
}

describe("SettingsPageClient — auto-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Store Hours ────────────────────────────────────────────────────────────

  describe("Store Hours", () => {
    it("does not render a 'Save Store Hours' button", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.queryByRole("button", { name: /save store hours/i })).not.toBeInTheDocument();
    });

    it("PUT /api/store-hours for that day when open-time input is blurred", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) =>
            url === "/api/store-hours" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.dayOfWeek).toBe(0);
        expect(body.openMinutes).toBe(540); // 9*60
      });
    });

    it("PUT /api/store-hours for that day when close-time input is blurred", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      const input = screen.getByLabelText("Monday close time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "21:00" } });
        fireEvent.blur(input);
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) =>
            url === "/api/store-hours" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.dayOfWeek).toBe(1);
        expect(body.closeMinutes).toBe(1260); // 21*60
      });
    });

    it("shows 'Saved ✓' in the day row after a successful save", async () => {
      setupFetch();
      await renderAndSettle();

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
      });

      await waitFor(() => {
        expect(screen.getByTestId("store-hours-status-0").textContent).toMatch(/Saved/);
      });
    });

    it("shows 'Failed to save' in the day row on API error", async () => {
      setupFetch({ putOk: false });
      await renderAndSettle();

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
      });

      await waitFor(() => {
        expect(screen.getByTestId("store-hours-status-0").textContent).toMatch(/Failed/);
      });
    });

    it("only saves the changed day, not all 7", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      const input = screen.getByLabelText("Wednesday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "07:00" } });
        fireEvent.blur(input);
      });

      await waitFor(() => {
        const putCalls = fetchSpy.mock.calls.filter(
          ([url, opts]) => url === "/api/store-hours" && opts?.method === "PUT"
        );
        expect(putCalls).toHaveLength(1);
        const body = JSON.parse(putCalls[0][1]!.body as string);
        expect(body.dayOfWeek).toBe(3);
      });
    });
  });

  // ── Coverage Thresholds ────────────────────────────────────────────────────

  describe("Coverage Thresholds", () => {
    it("does not render a 'Save Coverage' button", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.queryByRole("button", { name: /save coverage/i })).not.toBeInTheDocument();
    });

    it("debounces: PUT /api/settings fires 800 ms after tapping optimal +", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTestId("coverage-optimal-plus"));
      });

      // Not called yet
      expect(fetchSpy.mock.calls.filter(([u, o]) => u === "/api/settings" && o?.method === "PUT")).toHaveLength(0);

      await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve(); await Promise.resolve(); });

      const putCalls = fetchSpy.mock.calls.filter(([u, o]) => u === "/api/settings" && o?.method === "PUT");
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const body = JSON.parse(putCalls[0][1]!.body as string);
      expect(body).toMatchObject({ optimalCoverage: 4, minCoverage: 2 });
      vi.useRealTimers();
    });

    it("shows 'Saved ✓' after coverage save succeeds", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      setupFetch();
      await renderAndSettle();

      await act(async () => { fireEvent.click(screen.getByTestId("coverage-optimal-plus")); });
      await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve(); await Promise.resolve(); });

      await waitFor(() => {
        expect(screen.getByTestId("coverage-status").textContent).toMatch(/Saved/);
      });
      vi.useRealTimers();
    });

    it("shows validation error and skips API call when minCoverage > optimalCoverage", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = setupFetch();
      await renderAndSettle();

      // Tap optimal − until optimal < min (optimal starts at 3, min at 2 — tap optimal − twice)
      await act(async () => { fireEvent.click(screen.getByTestId("coverage-optimal-minus")); });
      await act(async () => { fireEvent.click(screen.getByTestId("coverage-optimal-minus")); });

      // optimal is now 1, min is 2 — validation error
      await waitFor(() => {
        expect(screen.getByTestId("coverage-validation-error")).toBeInTheDocument();
      });

      await act(async () => { vi.advanceTimersByTime(900); await Promise.resolve(); });

      const putCalls = fetchSpy.mock.calls.filter(([u, o]) => u === "/api/settings" && o?.method === "PUT");
      expect(putCalls).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  // ── Week Start ─────────────────────────────────────────────────────────────

  describe("Week Start", () => {
    it("does not render a standalone 'Save' button in the Week Start section", async () => {
      setupFetch();
      await renderAndSettle();
      // The only "Save" buttons remaining should be in employee name editing, not in week start
      expect(screen.queryByTestId("week-start-save-btn")).not.toBeInTheDocument();
    });

    it("immediately calls PUT /api/settings when a pill is clicked", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Monday" }));
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) => url === "/api/settings" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.firstDayOfWeek).toBe(1);
      });
    });

    it("shows 'Saved ✓' after week start pill click succeeds", async () => {
      setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Monday" }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("week-start-status").textContent).toMatch(/Saved/);
      });
    });

    it("shows 'Failed to save' when week start save fails", async () => {
      setupFetch({ putOk: false });
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Monday" }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("week-start-status").textContent).toMatch(/Failed/);
      });
    });
  });

  // ── Timezone ───────────────────────────────────────────────────────────────

  describe("Timezone", () => {
    it("does not render a 'Save Timezone' button", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.queryByRole("button", { name: /save timezone/i })).not.toBeInTheDocument();
    });

    it("immediately calls PUT /api/settings when select changes", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Timezone"), {
          target: { value: "America/Chicago" },
        });
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) => url === "/api/settings" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.timezone).toBe("America/Chicago");
      });
    });

    it("shows 'Saved ✓' after timezone change succeeds", async () => {
      setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Timezone"), {
          target: { value: "America/Chicago" },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("timezone-status").textContent).toMatch(/Saved/);
      });
    });

    it("shows 'Failed to save' when timezone save fails", async () => {
      setupFetch({ putOk: false });
      await renderAndSettle();

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Timezone"), {
          target: { value: "America/Chicago" },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("timezone-status").textContent).toMatch(/Failed/);
      });
    });
  });

  // ── Demo mode ──────────────────────────────────────────────────────────────

  describe("Demo mode", () => {
    it("store hours blur: no fetch, shows 'Saved ✓' after 250 ms", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = vi.spyOn(global, "fetch");

      render(<SettingsPageClient isDemo={true} />);
      await screen.findByLabelText("Sunday open time");

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      const putCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "PUT");
      expect(putCalls).toHaveLength(0);
      expect(screen.getByTestId("store-hours-status-0").textContent).toMatch(/Saved/);
      vi.useRealTimers();
    });

    it("coverage tap: no fetch, shows 'Saved ✓' after debounce", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = vi.spyOn(global, "fetch");

      render(<SettingsPageClient isDemo={true} />);
      await screen.findByLabelText("Sunday open time");

      await act(async () => {
        fireEvent.click(screen.getByTestId("coverage-optimal-plus"));
        vi.advanceTimersByTime(1100);
        await Promise.resolve();
        await Promise.resolve();
      });

      const putCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "PUT");
      expect(putCalls).toHaveLength(0);
      expect(screen.getByTestId("coverage-status").textContent).toMatch(/Saved/);
      vi.useRealTimers();
    });

    it("week start pill: no fetch, shows 'Saved ✓'", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = vi.spyOn(global, "fetch");

      render(<SettingsPageClient isDemo={true} />);
      await screen.findByLabelText("Sunday open time");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Monday" }));
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      const putCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "PUT");
      expect(putCalls).toHaveLength(0);
      expect(screen.getByTestId("week-start-status").textContent).toMatch(/Saved/);
      vi.useRealTimers();
    });

    it("timezone change: no fetch, shows 'Saved ✓'", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = vi.spyOn(global, "fetch");

      render(<SettingsPageClient isDemo={true} />);
      await screen.findByLabelText("Sunday open time");

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Timezone"), {
          target: { value: "America/Chicago" },
        });
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      const putCalls = fetchSpy.mock.calls.filter(([, o]) => o?.method === "PUT");
      expect(putCalls).toHaveLength(0);
      expect(screen.getByTestId("timezone-status").textContent).toMatch(/Saved/);
      vi.useRealTimers();
    });
  });

  // ── No regression ──────────────────────────────────────────────────────────

  describe("No regression", () => {
    it("email notifications toggle still auto-saves without needing any timer", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: /email notifications/i }));
        await Promise.resolve();
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) => url === "/api/settings" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body.emailNotifications).toBe(true);
      });
    });
  });
});
