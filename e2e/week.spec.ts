import { test, expect } from "@playwright/test";
import { NEXT_MON, NEXT_TUE, NEXT_WEEK, THIS_WEEK, TODAY, isPhone, longDay, mockWeek, openCell, setTimes } from "./week-mocks";

// The Week page: one page for the live schedule and drafts, with a Live |
// Draft toggle kept in the URL. Runs in the phone, tablet and desktop projects
// (playwright.config.ts): phones edit through the day list, wider screens
// through the team grid.

test.describe("Week page", () => {
  test("switches between Live and Draft and keeps the week", async ({ page }) => {
    await mockWeek(page);
    await page.goto("/week");

    await expect(page.getByRole("radio", { name: "Live" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("week-mode-hint")).toContainText("Changes go to the team right away");
    await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page).toHaveURL(new RegExp(`/week\\?week=${NEXT_WEEK}$`));
    // The toggle shows the week's drafts from Live.
    const draftToggle = page.getByRole("radio", { name: /^Draft/ });
    await expect(draftToggle).toHaveAccessibleName("Draft, 3 shifts");

    await draftToggle.click();
    await expect(page).toHaveURL(new RegExp(`/week\\?mode=draft&week=${NEXT_WEEK}$`));
    await expect(page.getByTestId("week-mode-hint")).toContainText("Private until you publish");
    // Alice's Monday draft clashes with her live shift, so 2 of 3 publish.
    await expect(page.getByRole("button", { name: "Publish (2)" })).toBeEnabled();
    await expect(page.getByTestId("auto-schedule-button")).toBeVisible();

    await page.getByRole("radio", { name: "Live" }).click();
    await expect(page).toHaveURL(new RegExp(`/week\\?week=${NEXT_WEEK}$`));
    await page.getByRole("button", { name: "This week" }).click();
    await expect(page).toHaveURL(new RegExp(`/week\\?week=${THIS_WEEK}$`));
  });

  test("Live edits go to the live schedule", async ({ page }) => {
    const state = await mockWeek(page);
    await page.goto("/week");

    const drawer = await openCell(page, "Alice Smith", TODAY);
    await drawer.getByRole("button", { name: "Edit Shift" }).click();
    await setTimes(page, "09:00", "18:00");
    await drawer.getByRole("button", { name: "Save Shift" }).click();
    await expect(drawer).toBeHidden();

    expect(state.calls).toEqual([
      { method: "PUT", path: "/api/schedules", body: { id: 1, startMinutes: 540, endMinutes: 1080, override: false } },
    ]);
  });

  test("Draft keeps live shifts read-only and edits drafts", async ({ page }) => {
    const state = await mockWeek(page);
    await page.goto(`/week?mode=draft&week=${NEXT_WEEK}`);

    // A draft that clashes with a live shift says so.
    let drawer = await openCell(page, "Alice Smith", NEXT_MON);
    await expect(drawer.getByRole("note")).toContainText("This draft won't publish");
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();

    // Adding a draft on a free day goes to the drafts.
    drawer = await openCell(page, "Bob Jones", NEXT_TUE);
    await drawer.getByRole("button", { name: "Add Draft" }).click();
    await setTimes(page, "10:00", "16:00");
    await drawer.getByRole("button", { name: "Save Draft" }).click();
    await expect(drawer).toBeHidden();
    expect(state.calls).toEqual([
      { method: "POST", path: "/api/drafts", body: { employeeId: 2, date: NEXT_TUE, startMinutes: 600, endMinutes: 960, override: false } },
    ]);
    await expect(page.getByRole("button", { name: "Publish (3)" })).toBeEnabled();

    // A live shift is view only, with a way to Live mode.
    drawer = await openCell(page, "Carol White", NEXT_WEEK);
    await expect(drawer.getByText("This shift is live.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Edit/ })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Switch to Live" }).click();
    await expect(page).toHaveURL(new RegExp(`/week\\?week=${NEXT_WEEK}$`));
    await expect(drawer.getByRole("button", { name: "Edit Shift" })).toBeVisible();
  });

  test("publishing shows the week live and keeps the draft that clashes", async ({ page }) => {
    const state = await mockWeek(page);
    await page.goto(`/week?mode=draft&week=${NEXT_WEEK}`);

    await page.getByRole("button", { name: "Publish (2)" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish Week?" });
    await expect(dialog).toContainText("2 draft shifts");
    await expect(dialog).toContainText("1 draft won't publish");
    await dialog.getByRole("button", { name: "Publish" }).click();

    await expect(page).toHaveURL(new RegExp(`/week\\?week=${NEXT_WEEK}$`));
    const result = page.getByTestId("publish-result");
    await expect(result).toContainText("Published 2 shifts.");
    await expect(result).toContainText("1 draft stayed in Draft: Alice S. already has a live shift");
    expect(state.calls.at(-1)).toEqual({ method: "POST", path: "/api/drafts/publish", body: { weekStart: NEXT_WEEK } });
    // The kept draft still counts on the toggle.
    await expect(page.getByRole("radio", { name: /^Draft/ })).toHaveAccessibleName("Draft, 1 shift");
  });

  test("old Planner links open Draft mode", async ({ page }) => {
    await mockWeek(page);
    await page.goto(`/draft?week=${NEXT_WEEK}`);
    await expect(page).toHaveURL(new RegExp(`/week\\?mode=draft&week=${NEXT_WEEK}$`));
    await expect(page.getByRole("radio", { name: /^Draft/ })).toHaveAttribute("aria-checked", "true");

    await page.goto("/draft");
    await expect(page).toHaveURL(/\/week\?mode=draft$/);
    // Draft opens on next week.
    await expect(page.getByRole("button", { name: "Publish (2)" })).toBeVisible();
  });

  test("phones edit through the day list, wider screens through the grid", async ({ page }) => {
    await mockWeek(page);
    await page.goto(`/week?week=${NEXT_WEEK}`);
    const grid = page.getByTestId("week-grid");
    const list = page.getByTestId("day-list");

    if (isPhone(page)) {
      await expect(list).toBeVisible();
      await expect(grid).toBeHidden();
      const chips = page.getByRole("group", { name: "Day" });
      await expect(chips.getByRole("button")).toHaveCount(7);
      await chips.getByRole("button", { name: longDay(NEXT_MON) }).click();
      await expect(list.getByRole("button", { name: /^Alice Smith: 9:00 AM to 5:00 PM/ })).toBeVisible();
    } else {
      await expect(grid).toBeVisible();
      await expect(list).toBeHidden();
      // The grid's day headers pick the day the charts follow.
      const tuesday = grid.getByRole("button", { name: longDay(NEXT_TUE), exact: true });
      await tuesday.click();
      await expect(tuesday).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("selected-day")).toContainText("Tuesday");
    }
  });
});
