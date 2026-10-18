import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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
  timezone: "America/New_York",
  emailNotifications: false,
  coverageAlertsEnabled: true,
  manualPunchesEnabled: true,
  gpsRequired: false,
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
        return { ok: true, json: async () => ({ isManager: true, employeeId: null }) } as Response;
      if (url.includes("/api/availability"))
        return { ok: true, json: async () => [] } as Response;
    }

    return { ok: putOk, json: async () => ({}) } as Response;
  });
}

async function renderAndSettle() {
  render(<SettingsPageClient />);
  // Wait for store hours section to appear (signals initial fetches resolved)
  await screen.findByTestId("store-hours-section");
}

async function openStoreHoursSheet(dow: number) {
  const row = screen.getByTestId(`day-row-${dow}`);
  await act(async () => { fireEvent.click(row); });
  await act(async () => { await Promise.resolve(); });
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
      await openStoreHoursSheet(0);

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
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
      await openStoreHoursSheet(1);

      const input = screen.getByLabelText("Monday close time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "21:00" } });
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
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
      await openStoreHoursSheet(0);

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("store-hours-status-0").textContent).toMatch(/Saved/);
      });
    });

    it("shows 'Failed to save' in the day row on API error", async () => {
      setupFetch({ putOk: false });
      await renderAndSettle();
      await openStoreHoursSheet(0);

      const input = screen.getByLabelText("Sunday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "09:00" } });
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("store-hours-status-0").textContent).toMatch(/Failed/);
      });
    });

    it("only saves the changed day, not all 7", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();
      await openStoreHoursSheet(3);

      const input = screen.getByLabelText("Wednesday open time");
      await act(async () => {
        fireEvent.change(input, { target: { value: "07:00" } });
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
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
    it("renders the coverage-profiles-link button for managers", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.getByTestId("coverage-profiles-link")).toBeInTheDocument();
    });

    it("coverage-profiles-link is a button with accessible text", async () => {
      setupFetch();
      await renderAndSettle();
      const btn = screen.getByTestId("coverage-profiles-link");
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.textContent).toMatch(/Coverage Profiles/i);
    });

    it("coverage alerts toggle immediately calls PUT /api/settings", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: /coverage alerts/i }));
        await Promise.resolve();
      });

      await waitFor(() => {
        const putCall = fetchSpy.mock.calls.find(
          ([url, opts]) => url === "/api/settings" && opts?.method === "PUT"
        );
        expect(putCall).toBeTruthy();
        const body = JSON.parse(putCall![1]!.body as string);
        expect(body).toMatchObject({ coverageAlertsEnabled: false });
      });
    });

    it("does not render optimalCoverage or minCoverage steppers", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.queryByTestId("coverage-optimal-plus")).not.toBeInTheDocument();
      expect(screen.queryByTestId("coverage-optimal-minus")).not.toBeInTheDocument();
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
    const pick = async (value: string) => {
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Timezone"), { target: { value } });
      });
    };
    const confirm = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Change timezone" }));
      });
    };
    const timezonePuts = (spy: ReturnType<typeof setupFetch>) =>
      spy.mock.calls.filter(([url, opts]) =>
        url === "/api/settings" && opts?.method === "PUT" && String(opts.body).includes("timezone"));

    it("does not render a 'Save Timezone' button", async () => {
      setupFetch();
      await renderAndSettle();
      expect(screen.queryByRole("button", { name: /save timezone/i })).not.toBeInTheDocument();
    });

    it("warns that past punches move to different days, and saves nothing until confirmed", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();
      expect(screen.queryByTestId("timezone-confirm")).not.toBeInTheDocument();

      await pick("America/Chicago");
      const warning = screen.getByTestId("timezone-confirm");
      expect(warning).toHaveTextContent("Change the store timezone to America/Chicago?");
      expect(warning).toHaveTextContent(/past punches/i);
      expect(warning).toHaveTextContent(/different day/i);
      expect(timezonePuts(fetchSpy)).toHaveLength(0);
    });

    it("calls PUT /api/settings once the change is confirmed", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();
      await pick("America/Chicago");
      await confirm();

      await waitFor(() => {
        const puts = timezonePuts(fetchSpy);
        expect(puts).toHaveLength(1);
        expect(JSON.parse(puts[0][1]!.body as string)).toEqual({ timezone: "America/Chicago" });
      });
      expect(screen.queryByTestId("timezone-confirm")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Timezone")).toHaveValue("America/Chicago");
    });

    it("keeps the old timezone when the change is cancelled", async () => {
      const fetchSpy = setupFetch();
      await renderAndSettle();
      await pick("America/Chicago");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Keep America/New_York" }));
      });
      expect(screen.queryByTestId("timezone-confirm")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Timezone")).toHaveValue("America/New_York");
      expect(timezonePuts(fetchSpy)).toHaveLength(0);
    });

    it("drops the warning when the current timezone is picked again", async () => {
      setupFetch();
      await renderAndSettle();
      await pick("America/Chicago");
      await pick("America/New_York");
      expect(screen.queryByTestId("timezone-confirm")).not.toBeInTheDocument();
    });

    it("shows 'Saved ✓' after timezone change succeeds", async () => {
      setupFetch();
      await renderAndSettle();
      await pick("America/Chicago");
      await confirm();
      await waitFor(() => {
        expect(screen.getByTestId("timezone-status").textContent).toMatch(/Saved/);
      });
    });

    it("shows 'Failed to save' when timezone save fails", async () => {
      setupFetch({ putOk: false });
      await renderAndSettle();
      await pick("America/Chicago");
      await confirm();
      await waitFor(() => {
        expect(screen.getByTestId("timezone-status").textContent).toMatch(/Failed/);
      });
    });
  });

});

// ── EmployeeAvailabilityRow (manager Settings) ─────────────────────────────

describe("EmployeeAvailabilityRow in SettingsPageClient", () => {
  function setupManagerFetch(availabilityRecords: any[] = []) {
    return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.includes("/api/store-hours")) return { ok: true, json: async () => DEFAULT_HOURS } as Response;
        if (url.includes("/api/settings"))   return { ok: true, json: async () => DEFAULT_SETTINGS } as Response;
        if (url.includes("/api/employees"))  return { ok: true, json: async () => [{ id: 5, name: "Alice Smith", email: "alice@test.com", user_id: null }] } as Response;
        if (url.includes("/api/me"))         return { ok: true, json: async () => ({ isManager: true }) } as Response;
        if (url.includes("/api/templates"))  return { ok: true, json: async () => ({ templates: [] }) } as Response;
        if (url.includes("/api/availability")) return { ok: true, json: async () => availabilityRecords } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  }

  it("lets a manager remove an employee who has no account yet", async () => {
    // No account means no user id, which must not match a signed-in user
    // who hasn't loaded yet (also no id) as "yourself".
    setupManagerFetch();
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    const remove = await screen.findByRole("button", { name: "Archive Alice Smith" });
    expect(remove).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cannot remove yourself" })).not.toBeInTheDocument();
  });

  it("says removing archives the employee and keeps their time records", async () => {
    setupManagerFetch();
    render(<SettingsPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive Alice Smith" }));
    expect(screen.getByText("Archive Alice Smith?")).toBeInTheDocument();
    expect(screen.getByText(/punches, time off\s+and past shifts are kept/)).toBeInTheDocument();
    expect(screen.queryByText(/permanently delete/)).not.toBeInTheDocument();
  }, 20_000); // The whole settings page renders; slow under jsdom.

  it("lists archived employees and restores one", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.includes("/api/store-hours")) return { ok: true, json: async () => DEFAULT_HOURS } as Response;
        if (url.includes("/api/settings"))   return { ok: true, json: async () => DEFAULT_SETTINGS } as Response;
        if (url.includes("/api/employees?include=archived"))
          return { ok: true, json: async () => [
            { id: 5, name: "Alice Smith", email: null, user_id: null, archived_at: null },
            { id: 9, name: "Bob Former", email: null, user_id: null, archived_at: "2026-09-30T15:00:00Z" },
          ] } as Response;
        if (url.includes("/api/employees"))  return { ok: true, json: async () => [{ id: 5, name: "Alice Smith", email: null, user_id: null }] } as Response;
        if (url.includes("/api/me"))         return { ok: true, json: async () => ({ isManager: true }) } as Response;
        if (url.includes("/api/templates"))  return { ok: true, json: async () => ({ templates: [] }) } as Response;
        if (url.includes("/api/availability")) return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(<SettingsPageClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Show archived employees" }));
    const restore = await screen.findByRole("button", { name: "Restore Bob Former" });
    expect(screen.queryByRole("button", { name: "Restore Alice Smith" })).not.toBeInTheDocument();
    fireEvent.click(restore);
    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ id: 9, archived: false });
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Restore Bob Former" })).not.toBeInTheDocument());
  }, 20_000);

  it("renders 'Typical Week' toggle for each employee when manager", async () => {
    setupManagerFetch();
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    await waitFor(() => expect(screen.getByTestId("employee-avail-5")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Toggle typical week" })).toBeInTheDocument();
  });

  it("expands to show 'No restrictions set' when employee has no records", async () => {
    setupManagerFetch([]);
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    await waitFor(() => expect(screen.getByTestId("employee-avail-5")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle typical week" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("No restrictions set")).toBeInTheDocument());
  });

  it("shows 'Unavailable' for Off days (null start/end)", async () => {
    setupManagerFetch([{ id: 1, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: null }]);
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    await waitFor(() => expect(screen.getByTestId("employee-avail-5")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle typical week" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument());
  });

  it("shows time range and availability bar for Window records", async () => {
    setupManagerFetch([{ id: 2, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320, note: null }]);
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    await waitFor(() => expect(screen.getByTestId("employee-avail-5")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle typical week" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/12:00 PM/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Mon availability bar/)).toBeInTheDocument();
    });
  });

  it("shows note under restricted day when note exists", async () => {
    setupManagerFetch([{ id: 1, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: "Family time" }]);
    render(<SettingsPageClient />);
    await screen.findByTestId("store-hours-section");
    await waitFor(() => expect(screen.getByTestId("employee-avail-5")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle typical week" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Family time")).toBeInTheDocument());
  });
});

// ── Employee (non-manager) view ───────────────────────────────────────────────

describe("SettingsPageClient — employee view", () => {
  function setupEmployeeFetch() {
    return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        if (url.includes("/api/me"))
          return { ok: true, json: async () => ({ isManager: false, employeeId: 5 }) } as Response;
        if (url.includes("/api/preferences"))
          return { ok: true, json: async () => ({ employeeId: 5, preferredShiftTypes: [], preferredDays: [], avoidDays: [], desiredWeeklyHours: null, note: null, updatedAt: null }) } as Response;
        if (url.includes("/api/availability"))
          return { ok: true, json: async () => [] } as Response;
        if (url.includes("/api/settings"))
          return { ok: true, json: async () => DEFAULT_SETTINGS } as Response;
        if (url.includes("/api/employees"))
          return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  }

  beforeEach(() => { vi.clearAllMocks(); setupEmployeeFetch(); });
  afterEach(() => vi.restoreAllMocks());

  it("shows the availability section for a linked employee", async () => {
    render(<SettingsPageClient />);
    await screen.findByTestId("availability-section");
    expect(screen.getByText("Availability")).toBeInTheDocument();
  });

  it("hides Store Hours from employees", async () => {
    render(<SettingsPageClient />);
    await screen.findByTestId("availability-section");
    expect(screen.queryByTestId("store-hours-section")).not.toBeInTheDocument();
  });

  it("hides Coverage Thresholds from employees", async () => {
    render(<SettingsPageClient />);
    await screen.findByTestId("availability-section");
    expect(screen.queryByText(/coverage thresholds/i)).not.toBeInTheDocument();
  });

  it("hides the Employees management section from non-managers", async () => {
    render(<SettingsPageClient />);
    await screen.findByTestId("availability-section");
    expect(screen.queryByRole("button", { name: /add employee/i })).not.toBeInTheDocument();
  });

  it("shows the Sign Out button to all users", async () => {
    render(<SettingsPageClient />);
    await screen.findByTestId("availability-section");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});

describe("SettingsPageClient — geofence without 'Require GPS'", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("offers the geofence switch while GPS isn't required, and saves it on its own", async () => {
    const fetchSpy = setupFetch();
    await renderAndSettle();
    const gps = screen.getByTestId("toggle-gps-required");
    expect(gps).toHaveAttribute("aria-checked", "false");
    const fence = screen.getByTestId("toggle-geofence-enabled");
    await act(async () => { fireEvent.click(fence); });
    await waitFor(() => {
      const put = fetchSpy.mock.calls.find(([url, opts]) =>
        url === "/api/settings" && opts?.method === "PUT" && String(opts.body).includes("geofenceEnabled"));
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1]!.body as string)).toEqual({ geofenceEnabled: true });
    });
  });
});
