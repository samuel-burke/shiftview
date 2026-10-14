import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Color contrast on the rendered screens, light and dark: axe's color-contrast
// rule on each one, and the theme switch (Settings, and an OS change in System
// mode) recoloring the page and its charts without a reload. The token pairs
// themselves are checked in lib/theme-tokens.test.ts. Runs in the mobile
// project at phone and desktop widths.

// Playwright runs from the project root.
const AXE = readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
const STORE_TZ = "America/New_York";

function storeNow(): { today: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { today: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const { today: TODAY, minutes: NOW } = storeNow();
const NAMES = ["Alice Smith", "Bob Jones", "Carol White", "Dan Brown", "Eve Davis", "Frank Miller"];
const EMPLOYEES = NAMES.map((name, i) => ({ id: i + 1, name, employment_type: i % 2 ? "part_time" : "full_time" }));
const clamp = (m: number) => Math.max(0, Math.min(1425, Math.round(m / 15) * 15));
// Openers, mids and closers around now, so every shift type and status shows.
const SCHEDULES = Array.from({ length: 15 }, (_, d) => addDays(TODAY, d - 7)).flatMap((date, d) =>
  [[1, -390, 90], [2, -270, 210], [3, -150, 330], [4, -450, -30], [5, 30, 450], [6, -330, 150]].map(([emp, a, b], i) => ({
    id: d * 10 + i + 1, employeeId: emp, date, startMinutes: clamp(NOW + a), endMinutes: Math.max(clamp(NOW + a) + 60, clamp(NOW + b)),
  })),
);
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const punch = (id: number, employeeId: number, punchType: string, minutesAgo: number) =>
  ({ id, employeeId, scheduleId: null, punchType, punchedAt: iso(minutesAgo), lat: null, lng: null, isManual: false, note: null });

async function mockApis(page: Page, role: "manager" | "employee", onBreak = false) {
  const me = { isManager: role === "manager", employeeId: role === "manager" ? 1 : 2, employeeName: role === "manager" ? "Alice Smith" : "Bob Jones", isDemo: false, orgId: "org-1", organizations: [] };
  const punches = [punch(1, 1, "clock_in", 390), punch(2, 2, "clock_in", 270), punch(3, 6, "clock_in", 330), punch(4, 6, "break_start", 10), ...(onBreak ? [punch(5, 2, "break_start", 5)] : [])];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams;
    const from = q.get("from") ?? q.get("date") ?? TODAY;
    const to = q.get("to") ?? from;
    const json = (() => {
      switch (url.pathname) {
        case "/api/me": return me;
        case "/api/settings": return { firstDayOfWeek: 0, coverageAlertsEnabled: true, timezone: STORE_TZ, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceRadius: 100 };
        case "/api/store-hours": return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }]));
        case "/api/employees": return EMPLOYEES;
        case "/api/schedules": return SCHEDULES.filter((s) => s.date >= from && s.date <= to);
        case "/api/punches": return punches;
        case "/api/punches/current": return { carriedOver: false, punches: punches.filter((p) => p.employeeId === me.employeeId) };
        case "/api/punches/missed": return { missedPunch: null };
        case "/api/callouts": return { callouts: [] };
        case "/api/coverage-profiles": return [{ id: 1, name: "Standard", blocks: [{ startMinutes: 360, endMinutes: 840, headcount: 3 }, { startMinutes: 840, endMinutes: 1320, headcount: 2 }] }];
        case "/api/coverage-assignments": return { defaults: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 1])), overrides: {} };
        case "/api/my-schedule": return { employeeId: me.employeeId, employeeName: me.employeeName, schedules: SCHEDULES.filter((s) => s.employeeId === me.employeeId && s.date >= from && s.date <= to) };
        case "/api/time-off": return { requests: [
          { id: 1, employeeId: 3, employeeName: "Carol White", date: addDays(TODAY, 3), status: "pending" },
          { id: 2, employeeId: 4, employeeName: "Dan Brown", date: addDays(TODAY, 4), status: "approved" },
          { id: 3, employeeId: 5, employeeName: "Eve Davis", date: addDays(TODAY, 5), status: "denied" },
        ] };
        case "/api/reports/coverage": return { days: Array.from({ length: 14 }, (_, i) => ({ date: addDays(TODAY, i - 13), count: 2 + (i % 5) })) };
        case "/api/preferences": return { employeeId: me.employeeId, preferredShiftTypes: ["opener"], preferredDays: [1], avoidDays: [0], desiredWeeklyHours: 30, note: null, updatedAt: null };
        case "/api/notification-preferences": return {};
        case "/api/punch-corrections": return { corrections: [] };
        default: return [];
      }
    })();
    await route.fulfill({ json }).catch(() => {});
  });
}

async function contrastViolations(page: Page): Promise<string[]> {
  // Measure the settled page, not text partway through a fade-in.
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length), { timeout: 10_000 }).toBe(0);
  await page.waitForTimeout(800); // framer-motion's JS-driven entrances
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { nodes: { target: string[]; any: { message: string }[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: ["color-contrast"] });
    return result.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any.map((a) => a.message).join("; ")}`));
  });
}

const SCREENS: { path: string; role: "manager" | "employee"; onBreak?: boolean; ready: (page: Page) => Promise<void> }[] = [
  { path: "/", role: "manager", ready: (p) => expect(p.getByText("Bob J.").filter({ visible: true }).first()).toBeVisible() },
  { path: "/", role: "employee", ready: (p) => expect(p.getByText(/Here Now/i).filter({ visible: true }).first()).toBeVisible() },
  { path: "/clock", role: "employee", ready: (p) => expect(p.getByText("Today's Shift")).toBeVisible() },
  { path: "/clock", role: "employee", onBreak: true, ready: (p) => expect(p.getByLabel(/Current break duration/)).toBeVisible() },
  { path: "/schedule", role: "employee", ready: (p) => expect(p.getByText("Shifts this week")).toBeVisible() },
  { path: "/week", role: "manager", ready: (p) => expect(p.getByText("Weekly Budget")).toBeVisible() },
  { path: "/requests", role: "manager", ready: (p) => expect(p.getByText("Carol White").first()).toBeVisible() },
  { path: "/reports", role: "manager", ready: (p) => expect(p.getByRole("button", { name: "Export CSV" })).toBeVisible() },
  { path: "/settings", role: "manager", ready: (p) => expect(p.getByText("Appearance")).toBeVisible() },
];

test.beforeEach(async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 600, "runs once, in the mobile project");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [412, 1440]) {
    for (const { path, role, onBreak, ready } of SCREENS) {
      test(`${path} (${role}${onBreak ? ", on break" : ""}) holds text contrast in ${theme} at ${width}px`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await mockApis(page, role, onBreak);
        await page.goto(path);
        await ready(page);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        expect(await contrastViolations(page)).toEqual([]);
      });
    }
  }
}

const bgOf = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const tokenOf = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("switching theme in Settings recolors the app without a reload", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("theme", "dark"); sessionStorage.setItem("seeded", "1"); } });
  await mockApis(page, "manager");
  await page.goto("/settings");
  await expect(page.getByText("Appearance")).toBeVisible();
  const darkBg = await bgOf(page);
  const darkTooltip = await tokenOf(page, "--chart-tooltip-fg");

  await page.getByRole("button", { name: "Light" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(await bgOf(page)).not.toBe(darkBg);
  expect(await tokenOf(page, "--chart-tooltip-fg")).not.toBe(darkTooltip);
  expect(await contrastViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Dark" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  expect(await bgOf(page)).toBe(darkBg);
});

test("System mode follows the OS, charts included", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApis(page, "manager");
  await page.goto("/");
  await expect(page.getByText("Bob J.").filter({ visible: true }).first()).toBeVisible();
  const line = page.locator(".recharts-area-curve").first();
  await expect(line).toBeVisible();
  const darkStroke = await line.evaluate((el) => getComputedStyle(el).stroke);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await expect.poll(() => line.evaluate((el) => getComputedStyle(el).stroke)).not.toBe(darkStroke);
  expect(await page.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content)).toBe(await tokenOf(page, "--color-bg"));
});
