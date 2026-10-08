import { expect, type Page } from "@playwright/test";

// Mocks for the Week page specs: every /api/* call is intercepted, and the
// schedules and drafts endpoints keep state the way the real ones do.

const STORE_TZ = "America/New_York";

export function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Monday, October 12", as the grid and the day chips name a day. */
export function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export const TODAY = todayKey();
export const THIS_WEEK = addDays(TODAY, -new Date(`${TODAY}T12:00:00Z`).getUTCDay()); // weeks start Sunday
export const NEXT_WEEK = addDays(THIS_WEEK, 7);
export const NEXT_MON = addDays(NEXT_WEEK, 1);
export const NEXT_TUE = addDays(NEXT_WEEK, 2);

const EMPLOYEES = [
  { id: 1, name: "Alice Smith", employment_type: "full_time" },
  { id: 2, name: "Bob Jones", employment_type: "part_time" },
  { id: 3, name: "Carol White", employment_type: "part_time" },
];

const STORE_HOURS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }]));

type Shift = { id: number; employeeId: number; date: string; startMinutes: number; endMinutes: number; generationRunId?: number | null };
type Call = { method: string; path: string; body: Record<string, unknown> | null };

export async function mockWeek(page: Page) {
  const state = {
    live: [
      { id: 1, employeeId: 1, date: TODAY, startMinutes: 540, endMinutes: 1020 },
      { id: 2, employeeId: 2, date: TODAY, startMinutes: 540, endMinutes: 780 },
      // Next week: Carol on Sunday and Alice on Monday are already live.
      { id: 3, employeeId: 3, date: NEXT_WEEK, startMinutes: 360, endMinutes: 840 },
      { id: 4, employeeId: 1, date: NEXT_MON, startMinutes: 540, endMinutes: 1020 },
    ] as Shift[],
    drafts: [
      { id: 11, employeeId: 2, date: NEXT_MON, startMinutes: 540, endMinutes: 1020, generationRunId: null },
      { id: 12, employeeId: 3, date: NEXT_TUE, startMinutes: 780, endMinutes: 1260, generationRunId: 7 },
      // Made before Alice's Monday went live: it won't publish.
      { id: 13, employeeId: 1, date: NEXT_MON, startMinutes: 600, endMinutes: 900, generationRunId: null },
    ] as Shift[],
    calls: [] as Call[],
    nextId: 100,
  };
  const inWeek = (date: string, from: string, to: string) => date >= from && date <= to;

  // Catch-all first: later, more specific routes take precedence.
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { isManager: true, employeeId: 1, employeeName: "Alice Smith", isDemo: false } })
  );
  await page.route("**/api/employees**", (route) => route.fulfill({ json: EMPLOYEES }));
  await page.route("**/api/store-hours**", (route) => route.fulfill({ json: STORE_HOURS }));
  await page.route("**/api/settings**", (route) =>
    route.fulfill({ json: { firstDayOfWeek: 0, coverageAlertsEnabled: true, timezone: STORE_TZ, emailNotifications: false, manualPunchesEnabled: true, gpsRequired: false, geofenceEnabled: false, geofenceLat: null, geofenceLng: null, geofenceRadius: 100, geofenceAddress: null } })
  );
  await page.route("**/api/coverage-profiles**", (route) =>
    route.fulfill({ json: [{ id: 1, name: "Standard", blocks: [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }] }] })
  );
  await page.route("**/api/coverage-assignments**", (route) =>
    route.fulfill({ json: { defaults: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 1])), overrides: {} } })
  );
  await page.route("**/api/time-off**", (route) => route.fulfill({ json: { requests: [] } }));

  await page.route("**/api/schedules**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postDataJSON() as Record<string, unknown> | null;
    if (req.method() === "GET") {
      const from = url.searchParams.get("from") ?? url.searchParams.get("date")!;
      const to = url.searchParams.get("to") ?? from;
      return route.fulfill({ json: state.live.filter((s) => inWeek(s.date, from, to)) });
    }
    state.calls.push({ method: req.method(), path: url.pathname, body });
    if (req.method() === "PUT") {
      state.live = state.live.map((s) => (s.id === body!.id ? { ...s, startMinutes: Number(body!.startMinutes), endMinutes: Number(body!.endMinutes) } : s));
    } else if (req.method() === "POST") {
      state.live.push({ id: state.nextId++, employeeId: Number(body!.employeeId), date: String(body!.date), startMinutes: Number(body!.startMinutes), endMinutes: Number(body!.endMinutes) });
    } else if (req.method() === "DELETE") {
      state.live = state.live.filter((s) => s.id !== body!.id);
    }
    return route.fulfill({ json: { ok: true } });
  });

  await page.route("**/api/drafts**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postDataJSON() as Record<string, unknown> | null;
    if (url.pathname === "/api/drafts/generate") return route.fulfill({ json: { run: null } });
    if (url.pathname === "/api/drafts/publish") {
      state.calls.push({ method: req.method(), path: url.pathname, body });
      const from = String(body!.weekStart);
      const to = addDays(from, 6);
      const week = state.drafts.filter((d) => inWeek(d.date, from, to));
      const taken = new Set(state.live.map((s) => `${s.employeeId}|${s.date}`));
      const toPublish = week.filter((d) => !taken.has(`${d.employeeId}|${d.date}`));
      const skipped = week.filter((d) => taken.has(`${d.employeeId}|${d.date}`));
      state.live.push(...toPublish.map((d) => ({ ...d, id: state.nextId++, generationRunId: undefined })));
      state.drafts = state.drafts.filter((d) => !toPublish.includes(d));
      return route.fulfill({
        json: {
          published: toPublish.length,
          skipped: skipped.length,
          skippedDrafts: skipped.map((d) => ({ id: d.id, employeeId: d.employeeId, date: d.date })),
        },
      });
    }
    if (req.method() === "GET") {
      const from = url.searchParams.get("weekStart")!;
      return route.fulfill({ json: state.drafts.filter((d) => inWeek(d.date, from, addDays(from, 6))) });
    }
    state.calls.push({ method: req.method(), path: url.pathname, body });
    if (req.method() === "POST") {
      state.drafts.push({ id: state.nextId++, employeeId: Number(body!.employeeId), date: String(body!.date), startMinutes: Number(body!.startMinutes), endMinutes: Number(body!.endMinutes), generationRunId: null });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

export const isPhone = (page: Page) => page.viewportSize()!.width < 600;

/** Opens a person's day in the editor: the day list on phones, the grid elsewhere. */
export async function openCell(page: Page, name: string, date: string) {
  if (isPhone(page)) {
    await page.getByRole("group", { name: "Day" }).getByRole("button", { name: longDay(date) }).click();
    await page.getByTestId("day-list").getByRole("button", { name: new RegExp(`^${name}:`) }).click();
  } else {
    await page.getByTestId("week-grid").getByRole("button", { name: new RegExp(`^${name}, ${longDay(date)}:`) }).click();
  }
  const drawer = page.getByRole("dialog", { name });
  await expect(drawer).toBeVisible();
  return drawer;
}

export async function setTimes(page: Page, start: string, end: string) {
  await page.getByLabel("Start time").fill(start);
  await page.getByLabel("End time").fill(end);
}
