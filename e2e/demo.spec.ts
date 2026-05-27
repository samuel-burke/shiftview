import { test, expect, type Page } from "@playwright/test";

// Shared mock data
const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
  { id: 3, name: "Carol White" },
];

const TODAY_KEY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

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

async function interceptAPIs(page: Page) {
  await page.route("**/api/employees**", (route) =>
    route.fulfill({ json: MOCK_EMPLOYEES })
  );
  await page.route("**/api/schedules**", (route) =>
    route.fulfill({ json: MOCK_SCHEDULES })
  );
  await page.route("**/api/me**", (route) =>
    route.fulfill({ json: { isManager: false } })
  );
  await page.route("**/api/store-hours**", (route) =>
    route.fulfill({ json: MOCK_STORE_HOURS })
  );
}

test.describe("Demo mode — schedule view", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/?demo=true");
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
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  });

  test("shows a Sign In option in the user menu in demo mode (not Sign Out)", async ({ page }) => {
    await page.getByRole("button", { name: "User menu" }).click();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).not.toBeVisible();
  });

  test("shows today's date in the header", async ({ page }) => {
    const today = new Date();
    const dayName = today.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });
    await expect(page.getByText(new RegExp(dayName, "i"))).toBeVisible();
  });
});

test.describe("Demo mode — date navigation", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/?demo=true");
  });

  test("navigates to the previous day with the back button", async ({ page }) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const prevDay = yesterday.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page.getByText(new RegExp(prevDay, "i"))).toBeVisible();
  });

  test("navigates to the next day with the forward button", async ({ page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextDay = tomorrow.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page.getByText(new RegExp(nextDay, "i"))).toBeVisible();
  });

  test("returns to today when Today button is clicked", async ({ page }) => {
    const today = new Date();
    const dayName = today.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });
    // Navigate away then back
    await page.getByRole("button", { name: "Previous day" }).click();
    await page.getByRole("button", { name: /today/i }).click();
    await expect(page.getByText(new RegExp(dayName, "i"))).toBeVisible();
  });
});

test.describe("Demo mode — employee drawer", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/?demo=true");
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
    await drawer.getByText("✕").click();
    await expect(drawer.getByText("6:00 AM")).not.toBeVisible();
  });

  test("does not show Edit Shift button in demo mode (non-manager)", async ({ page }) => {
    await page.getByText("Alice S.").first().click();
    await expect(page.getByRole("button", { name: /edit shift/i })).not.toBeVisible();
  });
});
