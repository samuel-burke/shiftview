import { test, expect, type Page } from "@playwright/test";

const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith", email: "alice@example.com", user_id: "user-alice" },
  { id: 2, name: "Bob Jones", email: "bob@example.com", user_id: "user-bob" },
  { id: 3, name: "Carol White", email: "carol@example.com", user_id: null },
];

const MOCK_MANAGER_IDS = { managerUserIds: ["user-alice"] };

async function interceptAPIs(page: Page, overrides: { managers?: object } = {}) {
  await page.route("**/api/employees**", (route) =>
    route.fulfill({ json: MOCK_EMPLOYEES })
  );
  await page.route("**/api/managers**", (route) =>
    route.fulfill({ json: overrides.managers ?? MOCK_MANAGER_IDS })
  );
}

test.describe("Admin page — role management", () => {
  test.beforeEach(async ({ page }) => {
    await interceptAPIs(page);
    await page.goto("/admin");
  });

  test("shows the Roles section heading", async ({ page }) => {
    await expect(page.getByText("Roles", { exact: true })).toBeVisible();
  });

  test("shows all employees", async ({ page }) => {
    await expect(page.getByText("Alice S.").or(page.getByText("Alice Smith"))).toBeVisible();
    await expect(page.getByText("Bob J.").or(page.getByText("Bob Jones"))).toBeVisible();
  });

  test("shows Manager badge for managers and Employee badge for others", async ({ page }) => {
    // Alice is a manager, Bob is not
    const managerBadges = page.getByText("Manager");
    const employeeBadges = page.getByText("Employee");
    await expect(managerBadges.first()).toBeVisible();
    await expect(employeeBadges.first()).toBeVisible();
  });

  test("shows Demote button for current managers", async ({ page }) => {
    await expect(page.getByRole("button", { name: /demote alice/i })).toBeVisible();
  });

  test("shows Promote button for non-managers with a linked account", async ({ page }) => {
    await expect(page.getByRole("button", { name: /promote bob/i })).toBeVisible();
  });

  test("shows No account for employees without a user_id", async ({ page }) => {
    await expect(page.getByText("No account")).toBeVisible();
  });

  test("shows back button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });
});
