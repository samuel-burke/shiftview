import { test, expect, type Page } from "@playwright/test";

// Planner → Auto-schedule → review the generated drafts → another version →
// undo. Every /api/* call is intercepted (see demo.spec.ts); the generate and
// undo mocks keep drafts and runs the way the real endpoints do. Runs in the
// phone, tablet and desktop projects (playwright.config.ts).

const STORE_TZ = "America/New_York";

const EMPLOYEES = [
  { id: 1, name: "Alice Smith", employment_type: "full_time" },
  { id: 2, name: "Bob Jones", employment_type: "part_time" },
  { id: 3, name: "Carol White", employment_type: "part_time" },
];

const STORE_HOURS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 480, close: 1320 }]));

// Two people from 9 AM to 5 PM, every day.
const PROFILE = { id: 1, name: "Standard", blocks: [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }] };

type Draft = { id: number; employeeId: number; date: string; startMinutes: number; endMinutes: number; generationRunId: number | null };
type GenerateBody = {
  weekStart: string;
  mode: "fill" | "replace";
  rules: { overtimePolicy: string; pendingTimeOff: string };
  adjustments: unknown[];
  replaceRunId?: number;
};
type Run = { runId: number; weekStart: string; previous: Draft[]; summary: Record<string, unknown> };

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The first version covers Sunday; another version adds Monday.
function generatedShifts(runId: number, weekStart: string, version: number): Draft[] {
  const sun = weekStart;
  const shifts: Omit<Draft, "id" | "generationRunId">[] = [
    { employeeId: 1, date: sun, startMinutes: 540, endMinutes: 1020 },
    { employeeId: 2, date: sun, startMinutes: 540, endMinutes: 780 },
    { employeeId: 3, date: sun, startMinutes: 780, endMinutes: 1020 },
  ];
  if (version > 1) shifts.push({ employeeId: 1, date: addDays(sun, 1), startMinutes: 540, endMinutes: 1020 });
  return shifts.map((s, i) => ({ ...s, id: runId * 100 + i, generationRunId: runId }));
}

function runSummary(runId: number, body: GenerateBody, shifts: Draft[]) {
  return {
    runId,
    weekStart: body.weekStart,
    mode: body.mode,
    seed: runId,
    createdAt: new Date().toISOString(),
    rules: body.rules,
    adjustments: body.adjustments,
    metrics: {
      coverageScore: 14 * shifts.length,
      coverageScoreBefore: 0,
      budgetHours: 112,
      scheduledHours: shifts.reduce((h, s) => h + (s.endMinutes - s.startMinutes) / 60, 0),
      generatedHours: shifts.reduce((h, s) => h + (s.endMinutes - s.startMinutes) / 60, 0),
      generatedShifts: shifts.length,
      shortfallHours: 96,
      overstaffHours: 0,
      overtimeHours: 0,
      laborCost: 0,
      employeesMissingRate: 3,
      preferenceScore: null,
    },
    gaps: [
      {
        date: addDays(body.weekStart, 2),
        startMinutes: 540,
        endMinutes: 1020,
        shortfall: 2,
        reasons: [{ code: "max_hours", employeeIds: [2] }],
      },
    ],
    suggestions: [{ kind: "raise_hours", employeeId: 2, maxHours: 32, overtime: false, gapMinutes: 240 }],
    warnings: [],
    employees: [],
  };
}

async function mockPlanner(page: Page) {
  const state = {
    drafts: [] as Draft[],
    runs: [] as Run[],
    generateBodies: [] as GenerateBody[],
    undone: [] as number[],
  };
  const liveRun = () => state.runs[state.runs.length - 1] ?? null;

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
  await page.route("**/api/coverage-profiles**", (route) => route.fulfill({ json: [PROFILE] }));
  await page.route("**/api/coverage-assignments**", (route) =>
    route.fulfill({ json: { defaults: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, PROFILE.id])), overrides: {} } })
  );
  await page.route("**/api/time-off**", (route) => route.fulfill({ json: { requests: [] } }));

  await page.route("**/api/drafts**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;

    if (path === "/api/drafts/generate" && req.method() === "GET") {
      const run = liveRun();
      return route.fulfill({ json: { run: run?.summary ?? null } });
    }
    if (path === "/api/drafts/generate") {
      const body = req.postDataJSON() as GenerateBody;
      state.generateBodies.push(body);
      const runId = state.runs.length === 0 ? 1 : state.runs[state.runs.length - 1].runId + 1;
      const replaced = body.replaceRunId ? state.runs.find((r) => r.runId === body.replaceRunId) : undefined;
      const previous = replaced ? replaced.previous : body.mode === "replace" ? state.drafts : [];
      const kept = replaced
        ? state.drafts.filter((d) => d.generationRunId !== replaced.runId)
        : body.mode === "replace" ? [] : state.drafts;
      const shifts = generatedShifts(runId, body.weekStart, state.runs.length + 1);
      state.drafts = [...kept, ...shifts];
      if (replaced) state.runs = state.runs.filter((r) => r !== replaced);
      const summary = runSummary(runId, body, shifts);
      state.runs.push({ runId, weekStart: body.weekStart, previous, summary });
      return route.fulfill({ json: { runId, run: summary } });
    }
    if (path === "/api/drafts/generate/undo") {
      const { runId } = req.postDataJSON() as { runId: number };
      state.undone.push(runId);
      const run = state.runs.find((r) => r.runId === runId)!;
      state.drafts = [...state.drafts.filter((d) => d.generationRunId !== runId && d.generationRunId !== null), ...run.previous];
      state.runs = state.runs.filter((r) => r !== run);
      return route.fulfill({ json: { ok: true, restored: run.previous.length } });
    }
    if (path === "/api/drafts" && req.method() === "GET") return route.fulfill({ json: state.drafts });
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

test.describe("Planner auto-schedule", () => {
  test("generates a week, tries another version and undoes it", async ({ page }) => {
    const state = await mockPlanner(page);
    await page.goto("/draft");

    // An empty week points to Auto-schedule.
    const empty = page.getByTestId("auto-schedule-empty");
    await expect(empty).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish (0)" })).toBeDisabled();

    await page.getByTestId("auto-schedule-button").click();
    const sheet = page.getByTestId("auto-schedule-sheet");
    await expect(sheet.getByText("Coverage targets set for every day")).toBeVisible();
    await expect(sheet.getByText("Everyone is set as full-time or part-time")).toBeVisible();
    await expect(sheet.getByText("No pending time-off requests this week")).toBeVisible();
    await sheet.getByRole("button", { name: "Generate Schedule" }).click();
    await expect(sheet).toBeHidden();

    const weekStart = state.generateBodies[0].weekStart;
    expect(state.generateBodies[0]).toEqual({
      weekStart,
      mode: "replace",
      rules: { overtimePolicy: "never", pendingTimeOff: "avoid" },
      adjustments: [],
    });

    // The summary, the new drafts (tagged Auto) and the week's charts.
    const summary = page.getByTestId("auto-schedule-summary");
    await expect(summary.getByRole("heading", { name: /Auto-scheduled 3 shifts/ })).toBeVisible();
    await expect(summary.getByText("Bob J.: at their weekly hours")).toBeVisible();
    await expect(empty).toBeHidden();
    await expect(page.getByRole("button", { name: "Publish (3)" })).toBeEnabled();
    await expect(page.getByText("Auto", { exact: true })).toHaveCount(3);
    await expect(page.getByText("8/40 h week")).toBeVisible();
    await expect(page.getByTestId("coverage-heatmap").getByRole("grid")).toBeVisible();
    await expect(page.getByTestId("draft-hours-panel")).toBeVisible();

    // Another version swaps only that run's drafts.
    await summary.getByRole("button", { name: "Try Another Version" }).click();
    await expect(summary.getByRole("heading", { name: /Auto-scheduled 4 shifts/ })).toBeVisible();
    expect(state.generateBodies[1]).toMatchObject({ weekStart, replaceRunId: 1 });
    await expect(page.getByRole("button", { name: "Publish (4)" })).toBeEnabled();

    // Undo brings back the week as it was before the first run.
    await summary.getByRole("button", { name: "Undo" }).click();
    await expect(summary).toBeHidden();
    expect(state.undone).toEqual([2]);
    await expect(page.getByRole("button", { name: "Publish (0)" })).toBeDisabled();
    await expect(empty).toBeVisible();
  });

  test("one day picker drives the hourly chart and the heatmap", async ({ page }) => {
    await mockPlanner(page);
    await page.goto("/draft");
    const picker = page.getByRole("group", { name: "Day" });
    const chips = picker.getByRole("button");
    await expect(chips).toHaveCount(7);

    // The hourly chart has no day buttons of its own; it shows the picker's day.
    await page.getByRole("tab", { name: "By Hour" }).click();
    const chartDay = page.getByTestId("coverage-chart-day");
    await expect(chartDay).toContainText("Sun");
    await chips.nth(2).click();
    await expect(chartDay).toContainText("Tue");

    // Tapping an hour in the heatmap selects its day everywhere.
    const heatmap = page.getByTestId("coverage-heatmap");
    await heatmap.getByRole("gridcell", { name: /^Thursday 10–11 AM/ }).click();
    await expect(chips.nth(4)).toHaveAttribute("aria-pressed", "true");
    await expect(chartDay).toContainText("Thu");
    await expect(heatmap.getByRole("row", { selected: true })).toContainText("Thu");

    // Below the desk layout the picker is further down; the chart links to it.
    const changeDay = page.getByRole("button", { name: "Change day" });
    if (page.viewportSize()!.width < 1024) {
      await changeDay.click();
      await expect(picker).toBeInViewport();
    } else {
      await expect(changeDay).toBeHidden();
    }
  });

  test("keeps the summary for the week after a reload", async ({ page }) => {
    const state = await mockPlanner(page);
    await page.goto("/draft");
    await page.getByTestId("auto-schedule-button").click();
    await page.getByTestId("auto-schedule-sheet").getByRole("button", { name: "Generate Schedule" }).click();
    await expect(page.getByTestId("auto-schedule-summary")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("auto-schedule-summary").getByRole("heading", { name: /Auto-scheduled 3 shifts/ })).toBeVisible();

    // Another week has its own (no) run.
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page.getByTestId("auto-schedule-summary")).toBeHidden();
    expect(state.runs).toHaveLength(1);
  });
});
