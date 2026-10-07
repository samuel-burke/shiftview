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
      for (const name of ["Team", "Schedule", "Clock", "Week", "Requests", "Admin", "Reports", "Settings"]) {
        await expect(rail.getByRole("link", { name })).toBeVisible();
      }
    }
  });

  for (const path of ["/", "/schedule", "/clock", "/reports", "/admin", "/week", "/week?mode=draft", "/requests"]) {
    test(`${path} never scrolls sideways`, async ({ page }) => {
      await interceptAPIs(page, { isManager: true });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // Against the device's width, not window.innerWidth: a phone zooms out to
      // fit content that's too wide, and innerWidth grows with it.
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width);
    });
  }

  test("uses the width for the dashboard's team lists", async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/");
    // Visible only: a streamed production page can briefly hold a hidden copy.
    const headers = page.getByTestId("team-section-header").filter({ visible: true });
    const scheduled = headers.filter({ hasText: "Scheduled" });
    const off = headers.filter({ hasText: "Off Today" });
    await expect(off).toBeVisible();
    await expect(scheduled).toBeVisible();

    // Read both positions from the same layout, in one call, so nothing can
    // shift the page between the two reads.
    const offsets = () =>
      page.evaluate(() => {
        const visible = [...document.querySelectorAll<HTMLElement>('[data-testid="team-section-header"]')].filter(
          (el) => el.offsetParent !== null,
        );
        const rect = (label: string) => visible.find((el) => el.textContent?.startsWith(label))!.getBoundingClientRect();
        const a = rect("Scheduled");
        const b = rect("Off Today");
        return { dx: b.x - a.x, dy: b.y - a.y };
      });

    const size = sizeOf(page);
    if (size === "tablet" || size === "wide") {
      // Side by side: same row, Off Today to the right.
      const { dx, dy } = await offsets();
      expect(Math.abs(dy)).toBeLessThan(4);
      expect(dx).toBeGreaterThan(0);
    } else {
      // One column (phone, or the desk layout's right-hand list).
      const { dx, dy } = await offsets();
      expect(dy).toBeGreaterThan(0);
      expect(Math.abs(dx)).toBeLessThan(4);
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

  test("the Week page opens a shift for editing", async ({ page }) => {
    await interceptAPIs(page, { isManager: true });
    await page.goto("/week");
    if (sizeOf(page) === "compact") {
      // Phones edit through the day list, on today.
      await page.getByTestId("day-list").getByRole("button", { name: /^Alice Smith: 6:00 AM to 2:00 PM/ }).click();
    } else {
      const grid = page.getByTestId("week-grid");
      await expect(grid.getByRole("rowheader", { name: /Alice S\./ })).toBeVisible();
      await grid.getByRole("button", { name: /Alice Smith, .*: Opener 6a to 2p/ }).click();
    }
    const drawer = page.getByTestId("employee-drawer");
    await expect(drawer.getByText("6:00 AM")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /edit shift/i })).toBeVisible();
  });

  test("the requests inbox approves a request and moves to the next", async ({ page }) => {
    await interceptAPIs(page, { isManager: true });
    let pending = [
      { id: 5, employeeId: 1, employeeName: "Alice Smith", date: todayKey(), status: "pending", note: "Family wedding" },
      { id: 6, employeeId: 3, employeeName: "Carol White", date: todayKey(), status: "pending" },
    ];
    const decisions: string[] = [];
    await page.route("**/api/time-off", (route) => route.fulfill({ json: { requests: pending } }));
    await page.route("**/api/time-off/*", async (route) => {
      const id = Number(route.request().url().split("/").pop());
      decisions.push(`${id}:${route.request().postDataJSON().status}`);
      pending = pending.filter((r) => r.id !== id);
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/requests");

    const list = page.getByRole("list", { name: "Pending requests" });
    await list.getByRole("button", { name: /Alice Smith/ }).click();
    const detail = page.getByTestId("request-detail").filter({ visible: true });
    await expect(detail.getByText("“Family wedding”")).toBeVisible();

    await detail.getByRole("button", { name: "Approve" }).click();
    await expect(list.getByRole("button", { name: /Alice Smith/ })).toHaveCount(0);
    expect(decisions).toEqual(["5:approved"]);

    if (sizeOf(page) !== "compact") {
      // Wider screens move straight on to the next request.
      await expect(detail.getByRole("heading", { name: "Carol White" })).toBeVisible();
    }
  });

  test("the desk-size rail widens into the full sidebar and remembers it", async ({ page }) => {
    await interceptAPIs(page, { isManager: true });
    await page.goto("/");
    await expect(page.getByText("Alice S.").first()).toBeVisible();

    const expand = page.getByRole("button", { name: "Expand sidebar" });
    if (sizeOf(page) !== "desk") {
      // Phones, tablets and wide screens have a fixed nav, so there's no toggle.
      await expect(expand).toBeHidden();
      return;
    }

    // Activate from the keyboard: under `next dev` the Next.js indicator sits
    // over the rail's bottom corner and would swallow a pointer click.
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("side-nav")).toBeVisible();
    await expect(page.getByTestId("nav-rail")).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("side-nav")).toBeVisible();

    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
    await collapse.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("nav-rail")).toBeVisible();
    await expect(page.getByTestId("side-nav")).toBeHidden();
  });
});
