import { test, expect, type Page } from "@playwright/test";

// Layout stability: the main screens load with their API responses arriving
// staggered and out of order, the way they do on a slow connection, and must
// not shift as they fill in (Cumulative Layout Shift under 0.01). Shifts right
// after a tap are excluded, as CLS does. Runs in the mobile project only.

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
const NAMES = ["Alice Smith", "Bob Jones", "Carol White", "Dan Brown", "Eve Davis", "Frank Miller", "Grace Lee", "Hank Wilson"];
const EMPLOYEES = NAMES.map((name, i) => ({ id: i + 1, name, employment_type: i % 2 ? "part_time" : "full_time" }));
const clamp = (m: number) => Math.max(0, Math.min(1425, Math.round(m / 15) * 15));
const SCHEDULES = Array.from({ length: 15 }, (_, d) => addDays(TODAY, d - 7)).flatMap((date, d) =>
  [[1, -180, 300], [2, -60, 420], [3, 60, 540], [4, -300, -30], [5, 120, 600]].map(([emp, a, b], i) => {
    const base = date === TODAY ? NOW : 600;
    return { id: d * 10 + i + 1, employeeId: emp, date, startMinutes: clamp(base + a), endMinutes: Math.max(clamp(base + a) + 60, clamp(base + b)) };
  }),
);
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const PUNCHES = [
  { id: 1, employeeId: 1, scheduleId: null, punchType: "clock_in", punchedAt: iso(170), lat: null, lng: null, isManual: false, note: null },
  { id: 2, employeeId: 2, scheduleId: null, punchType: "clock_in", punchedAt: iso(55), lat: null, lng: null, isManual: false, note: null },
];

// Each endpoint answers after its own delay, so the screen fills in pieces.
const DELAYS: Record<string, number> = {
  "/api/me": 150, "/api/settings": 250, "/api/store-hours": 200, "/api/employees": 300, "/api/schedules": 400,
  "/api/punches": 500, "/api/callouts": 650, "/api/coverage-assignments": 350, "/api/coverage-profiles": 300,
  "/api/my-schedule": 400, "/api/time-off": 550, "/api/swaps": 600, "/api/punches/current": 450, "/api/drafts": 500,
};

async function mockApis(page: Page, role: "manager" | "employee") {
  const me = { isManager: role === "manager", employeeId: role === "manager" ? 1 : 2, employeeName: role === "manager" ? "Alice Smith" : "Bob Jones", isDemo: false, orgId: "org-1", organizations: [] };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    await new Promise((r) => setTimeout(r, DELAYS[path] ?? 300));
    const q = url.searchParams;
    const from = q.get("from") ?? q.get("date") ?? TODAY;
    const to = q.get("to") ?? from;
    const json = (() => {
      switch (path) {
        case "/api/me": return me;
        case "/api/settings": return { firstDayOfWeek: 0, coverageAlertsEnabled: true, timezone: STORE_TZ, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceRadius: 100 };
        case "/api/store-hours": return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 0, close: 1439 }]));
        case "/api/employees": return EMPLOYEES;
        case "/api/schedules": return SCHEDULES.filter((s) => s.date >= from && s.date <= to);
        case "/api/punches": return PUNCHES;
        case "/api/punches/current": return { carriedOver: false, punches: PUNCHES.filter((p) => p.employeeId === me.employeeId) };
        case "/api/punches/missed": return { missedPunch: null };
        case "/api/callouts": return { callouts: q.get("date") ? [{ id: 1, employeeId: 6, employeeName: "Frank Miller", date: TODAY }] : [] };
        case "/api/coverage-profiles": return [{ id: 1, name: "Standard", blocks: [{ startMinutes: 0, endMinutes: 1439, headcount: 4 }] }];
        case "/api/coverage-assignments": return { defaults: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 1])), overrides: {} };
        case "/api/my-schedule": return { employeeId: me.employeeId, employeeName: me.employeeName, schedules: SCHEDULES.filter((s) => s.employeeId === me.employeeId && s.date >= from && s.date <= to) };
        case "/api/time-off": return { requests: [] };
        case "/api/reports/coverage": return { days: [] };
        default: return [];
      }
    })();
    await route.fulfill({ json }).catch(() => {});
  });
}

// Sums every layout shift not caused by a recent tap (an upper bound on CLS,
// which takes the worst burst of them).
async function layoutShift(page: Page): Promise<{ total: number; sources: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    return {
      total: w.__shifts.reduce((sum, s) => sum + s.value, 0),
      sources: w.__shifts.map((s) => `${s.value.toFixed(4)} ${s.sources.join(" | ")}`),
    };
  });
}

test.beforeEach(async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 600, "phone layout");
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[]) {
        if (entry.hadRecentInput) continue;
        const sources = (entry.sources ?? []).map((s) => {
          const el = s.node instanceof Element ? s.node : s.node?.parentElement;
          return el ? `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}` : "?";
        });
        w.__shifts.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
});

const SCREENS: { path: string; role: "manager" | "employee"; ready: (page: Page) => Promise<void> }[] = [
  { path: "/", role: "manager", ready: (p) => expect(p.getByText("Alice S.").filter({ visible: true }).first()).toBeVisible() },
  { path: "/", role: "employee", ready: (p) => expect(p.getByText("Off Today").filter({ visible: true }).first()).toBeVisible() },
  { path: "/schedule", role: "employee", ready: (p) => expect(p.getByText("Shifts this week")).toBeVisible() },
  { path: "/clock", role: "employee", ready: (p) => expect(p.getByText("Today's Shift")).toBeVisible() },
  { path: "/week", role: "manager", ready: (p) => expect(p.getByTestId("day-list").getByRole("button").first()).toBeVisible() },
  { path: "/reports", role: "manager", ready: (p) => expect(p.getByRole("button", { name: "Export CSV" })).toBeVisible() },
];

for (const { path, role, ready } of SCREENS) {
  test(`${path} (${role}) doesn't shift while it loads`, async ({ page }) => {
    await mockApis(page, role);
    await page.goto(path);
    await ready(page);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const { total, sources } = await layoutShift(page);
    expect(total, `layout shifts:\n${sources.join("\n")}`).toBeLessThan(0.01);
  });
}
