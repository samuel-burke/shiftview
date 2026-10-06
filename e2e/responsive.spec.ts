import { test, expect, type Page } from "@playwright/test";

// Layout checks per size class (see app/globals.css): compact < 600 ≤ tablet
// < 1024 ≤ desk < 1440 ≤ wide. Runs in the mobile, tablet and desktop
// projects (playwright.config.ts); each test reads the viewport to decide what
// it should see. All /api/* calls are mocked, as in demo.spec.ts.

const STORE_TZ = "America/New_York";

function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
  { id: 3, name: "Carol White" },
];

const SCHEDULES = [
  { id: 1, employeeId: 1, date: todayKey(), startMinutes: 360, endMinutes: 840 },
  { id: 2, employeeId: 2, date: todayKey(), startMinutes: 540, endMinutes: 1020 },
];

const STORE_HOURS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }]));

async function interceptAPIs(page: Page, { isManager = false } = {}) {
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/employees**", (route) => route.fulfill({ json: EMPLOYEES }));
  await page.route("**/api/schedules**", (route) => route.fulfill({ json: SCHEDULES }));
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { isManager, employeeId: 1, employeeName: "Alice Smith", isDemo: false } })
  );
  await page.route("**/api/store-hours**", (route) => route.fulfill({ json: STORE_HOURS }));
  await page.route("**/api/settings**", (route) =>
    route.fulfill({ json: { firstDayOfWeek: 0, coverageAlertsEnabled: true, timezone: STORE_TZ, emailNotifications: false, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceLat: null, geofenceLng: null, geofenceRadius: 100, geofenceAddress: null } })
  );
  await page.route("**/api/coverage-assignments**", (route) => route.fulfill({ json: { defaults: {}, overrides: {} } }));
}

type Size = "compact" | "tablet" | "desk" | "wide";
function sizeOf(page: Page): Size {
  const w = page.viewportSize()!.width;
  return w >= 1440 ? "wide" : w >= 1024 ? "desk" : w >= 600 ? "tablet" : "compact";
}

test.describe("Responsive layout", () => {
  test("shows the navigation for its size class", async ({ page }) => {
    await interceptAPIs(page, { isManager: true });
    await page.goto("/");
    await expect(page.getByText("Alice S.").first()).toBeVisible();

    const size = sizeOf(page);
    const bottom = page.getByTestId("bottom-nav");
    const rail = page.getByTestId("nav-rail");
    const side = page.getByTestId("side-nav");

    if (size === "compact") {
      await expect(bottom).toBeVisible();
      await expect(rail).toBeHidden();
      await expect(side).toBeHidden();
    } else if (size === "wide") {
      await expect(side).toBeVisible();
      await expect(rail).toBeHidden();
      await expect(bottom).toBeHidden();
    } else {
      await expect(rail).toBeVisible();
      await expect(side).toBeHidden();
      await expect(bottom).toBeHidden();
      // The rail reaches every destination, including the manager ones the
      // phone's bottom tabs leave out.
      for (const name of ["Team", "Schedule", "Clock", "Planner", "Admin", "Reports", "Settings"]) {
        await expect(rail.getByRole("link", { name })).toBeVisible();
      }
    }
  });

  for (const path of ["/", "/schedule", "/clock", "/draft", "/reports", "/admin"]) {
    test(`${path} never scrolls sideways`, async ({ page }) => {
      await interceptAPIs(page, { isManager: true });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }

  test("uses the width for the dashboard's team lists", async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
    const headers = page.getByTestId("team-section-header");
    const scheduled = headers.filter({ hasText: "Scheduled" });
    const off = headers.filter({ hasText: "Off Today" });
    await expect(off).toBeVisible();
    const a = (await scheduled.boundingBox())!;
    const b = (await off.boundingBox())!;

    const size = sizeOf(page);
    if (size === "tablet" || size === "wide") {
      // Side by side: same row, Off Today to the right.
      expect(Math.abs(a.y - b.y)).toBeLessThan(4);
      expect(b.x).toBeGreaterThan(a.x);
    } else {
      // One column (phone, or the desk layout's right-hand list).
      expect(b.y).toBeGreaterThan(a.y);
      expect(Math.abs(a.x - b.x)).toBeLessThan(4);
    }
  });

  test("opens employee detail as a side panel from the tablet size up", async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
    await page.getByText("Alice S.").first().click();
    const drawer = page.getByTestId("employee-drawer");
    await expect(drawer.getByText("6:00 AM")).toBeVisible();
    await page.waitForTimeout(500); // let the slide-in spring settle

    const box = (await drawer.boundingBox())!;
    const vp = page.viewportSize()!;
    if (sizeOf(page) === "compact") {
      // Bottom sheet: full width, anchored to the bottom edge.
      expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(vp.height - 2);
      expect(box.width).toBeGreaterThan(vp.width - 4);
    } else {
      // Side panel: full height on the right, leaving the dashboard visible.
      expect(box.height).toBeGreaterThanOrEqual(vp.height - 2);
      expect(Math.round(box.x + box.width)).toBeGreaterThanOrEqual(vp.width - 2);
      expect(box.width).toBeLessThan(vp.width * 0.75);
    }

    if (sizeOf(page) === "wide") {
      // Non-modal pane: the dashboard stays usable, so picking another person
      // swaps the pane's content without closing it first.
      await page.getByText("Bob J.").first().click();
      await expect(drawer.getByText("9:00 AM")).toBeVisible();
      await expect(drawer.getByText("6:00 AM")).toBeHidden();
    }
  });
});
