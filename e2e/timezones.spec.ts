import { test, expect, type Page } from "@playwright/test";

// The store and the browser sit on opposite sides of the date line. At
// 12:00 UTC on Oct 5, 2026 it is 01:00 on Oct 5 in Pago Pago (UTC−11, the
// device) but already 02:00 on Oct 6 in Kiritimati (UTC+14, the store). The
// dashboard must work in the store's calendar day.
const NOW = new Date("2026-10-05T12:00:00Z");
const STORE_TZ = "Pacific/Kiritimati";
const STORE_TODAY = "2026-10-06";

test.use({ timezoneId: "Pacific/Pago_Pago" });

const SETTINGS = {
  firstDayOfWeek: 6, coverageAlertsEnabled: true, timezone: STORE_TZ, emailNotifications: false,
  manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceLat: null,
  geofenceLng: null, geofenceRadius: 100, geofenceAddress: null,
};

async function intercept(page: Page, requestedDates: string[]) {
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/employees**", (route) =>
    route.fulfill({ json: [{ id: 1, name: "Alice Smith" }, { id: 2, name: "Bob Jones" }] })
  );
  await page.route("**/api/me**", (route) =>
    route.fulfill({ json: { isManager: false, employeeId: null, employeeName: null, isDemo: false } })
  );
  await page.route("**/api/store-hours**", (route) =>
    route.fulfill({ json: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }])) })
  );
  await page.route("**/api/settings**", (route) => route.fulfill({ json: SETTINGS }));
  await page.route("**/api/coverage-assignments**", (route) =>
    route.fulfill({ json: { defaults: {}, overrides: {} } })
  );
  // Alice works the store's today; Bob works the device's today.
  await page.route("**/api/schedules**", (route) => {
    const date = new URL(route.request().url()).searchParams.get("date") ?? "";
    requestedDates.push(date);
    route.fulfill({
      json: [
        { id: 1, employeeId: 1, date: STORE_TODAY, startMinutes: 360, endMinutes: 840 },
        { id: 2, employeeId: 2, date: "2026-10-05", startMinutes: 540, endMinutes: 1020 },
      ].filter((s) => s.date === date),
    });
  });
}

test.describe("Dashboard — store and device in different timezones", () => {
  test("opens on the store's today, not the device's", async ({ page }) => {
    const requested: string[] = [];
    await page.clock.setFixedTime(NOW);
    await intercept(page, requested);
    await page.goto("/");

    const nav = page.getByTestId("mobile-date-nav");
    await expect(nav.getByText(/October 6, 2026/i)).toBeVisible();
    await expect(nav.getByRole("button", { name: /October 6, 2026, Tuesday/i })).toBeVisible();
    await expect(page.getByText("Alice S.")).toBeVisible();
    await expect(page.getByText("Bob J.")).toHaveCount(1); // listed under "Off Today", not scheduled
    expect(requested).toContain(STORE_TODAY);
  });

  test("steps through store calendar days", async ({ page }) => {
    const requested: string[] = [];
    await page.clock.setFixedTime(NOW);
    await intercept(page, requested);
    await page.goto("/");

    const nav = page.getByTestId("mobile-date-nav");
    await expect(nav.getByText(/October 6, 2026/i)).toBeVisible();
    await nav.getByRole("button", { name: "Next day" }).click();
    await expect(nav.getByText(/October 7, 2026/i)).toBeVisible();
    await expect.poll(() => requested).toContain("2026-10-07");
    await nav.getByRole("button", { name: "Previous day" }).click();
    await nav.getByRole("button", { name: "Previous day" }).click();
    await expect(nav.getByText(/October 5, 2026/i)).toBeVisible();
    await expect.poll(() => requested).toContain("2026-10-05");
  });
});
