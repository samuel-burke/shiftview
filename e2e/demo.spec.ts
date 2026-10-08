import { test, expect, type Page } from "@playwright/test";

// These specs exercise the dashboard UI with all /api/* calls intercepted
// client-side. The Playwright webServer runs with E2E_BYPASS_AUTH=1 (see
// playwright.config.ts) so the server-side auth gate is skipped — no Supabase
// instance is required.

// Shared mock data
const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
  { id: 3, name: "Carol White" },
];

// The store's timezone (see the /api/settings mock). The app shows the store's
// calendar day, which can differ from the test runner's or the browser's.
const STORE_TZ = "America/New_York";

function dateKeyIn(tz: string, d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const TODAY_KEY = dateKeyIn(STORE_TZ);

// "October 5, 2026"-style label for the store's today plus `offsetDays`.
function storeDateLabel(offsetDays = 0): string {
  const d = new Date(`${TODAY_KEY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const MOCK_SCHEDULES = [
  { id: 1, employeeId: 1, date: TODAY_KEY, startMinutes: 360, endMinutes: 840 },
  { id: 2, employeeId: 2, date: TODAY_KEY, startMinutes: 540, endMinutes: 1020 },
];

const MOCK_STORE_HOURS = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

// The visible date nav. Production builds stream the page, so for a moment a
// hidden copy of the header can sit in the DOM next to the live one; matching
// only visible elements keeps strict-mode locators from seeing both.
function dateNav(page: Page) {
  return page.getByTestId("mobile-date-nav").filter({ visible: true });
}

async function interceptAPIs(page: Page) {
  // Catch-all FIRST so later, more specific routes take precedence. Without
  // this, unmocked endpoints hit the real handlers, 401, and bounce to /login.
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/employees**", (route) =>
    route.fulfill({ json: MOCK_EMPLOYEES })
  );
  await page.route("**/api/schedules**", (route) =>
    route.fulfill({ json: MOCK_SCHEDULES })
  );
  await page.route("**/api/me**", (route) =>
    route.fulfill({ json: { isManager: false, employeeId: null, employeeName: null, isDemo: false } })
  );
  await page.route("**/api/store-hours**", (route) =>
    route.fulfill({ json: MOCK_STORE_HOURS })
  );
  await page.route("**/api/settings**", (route) =>
    route.fulfill({ json: { firstDayOfWeek: 6, coverageAlertsEnabled: true, timezone: STORE_TZ, emailNotifications: false, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceLat: null, geofenceLng: null, geofenceRadius: 100, geofenceAddress: null } })
  );
  await page.route("**/api/coverage-assignments**", (route) =>
    route.fulfill({ json: { defaults: {}, overrides: {} } })
  );
}

test.describe("Dashboard — schedule view", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
  });

  test("page loads and shows scheduled employees", async ({ page }) => {
    await expect(page.getByText("Alice S.")).toBeVisible();
    await expect(page.getByText("Bob J.")).toBeVisible();
  });

  test("shows Carol W. in the Off Today section", async ({ page }) => {
    await expect(page.getByText("Carol W.")).toBeVisible();
    await expect(page.getByText("Off Today")).toBeVisible();
  });

  test("shows the coverage timeline", async ({ page }) => {
    await expect(page.getByText("Coverage Timeline")).toBeVisible();
  });

  test("shows the Scheduled section with count", async ({ page }) => {
    await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible();
  });

  test("shows a Sign Out option in the user menu", async ({ page }) => {
    await page.getByRole("button", { name: "User menu" }).click();
    await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /sign in/i })).not.toBeVisible();
  });

  test("shows today's date in the header", async ({ page }) => {
    const todayLabel = storeDateLabel();
    await expect(dateNav(page).getByText(new RegExp(todayLabel, "i"))).toBeVisible();
  });
});

test.describe("Dashboard — date navigation", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
  });

  test("navigates to the previous day with the back button", async ({ page }) => {
    const prevLabel = storeDateLabel(-1);
    await dateNav(page).getByRole("button", { name: "Previous day" }).click();
    await expect(dateNav(page).getByText(new RegExp(prevLabel, "i"))).toBeVisible();
  });

  test("navigates to the next day with the forward button", async ({ page }) => {
    const nextLabel = storeDateLabel(1);
    await dateNav(page).getByRole("button", { name: "Next day" }).click();
    await expect(dateNav(page).getByText(new RegExp(nextLabel, "i"))).toBeVisible();
  });

  test("returns to today when Today button is clicked", async ({ page }) => {
    const todayLabel = storeDateLabel();
    // Navigate away then back
    await dateNav(page).getByRole("button", { name: "Previous day" }).click();
    await page.getByRole("button", { name: /back to today/i }).click();
    await expect(dateNav(page).getByText(new RegExp(todayLabel, "i"))).toBeVisible();
  });
});

test.describe("Dashboard — employee drawer", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
  });

  test("opens drawer when a shift card is tapped", async ({ page }) => {
    await page.getByText("Alice S.").first().click();
    const drawer = page.getByTestId("employee-drawer");
    await expect(drawer.getByText("6:00 AM")).toBeVisible();
    await expect(drawer.getByText("2:00 PM")).toBeVisible();
  });

  test("shows shift type in drawer", async ({ page }) => {
    await page.getByText("Alice S.").first().click();
    const drawer = page.getByTestId("employee-drawer");
    await expect(drawer.getByText("Opener", { exact: true })).toBeVisible();
  });

  test("closes drawer when close button is tapped", async ({ page }) => {
    await page.getByText("Alice S.").first().click();
    const drawer = page.getByTestId("employee-drawer");
    await expect(drawer.getByText("6:00 AM")).toBeVisible();
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer.getByText("6:00 AM")).not.toBeVisible();
  });

  test("does not show Edit Shift button for non-managers", async ({ page }) => {
    await page.getByText("Alice S.").first().click();
    await expect(page.getByRole("button", { name: /edit shift/i })).not.toBeVisible();
  });
});
