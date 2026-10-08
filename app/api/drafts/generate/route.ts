import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { isDateKey } from "@/lib/dates";
import { applySchedulingRulesPatch } from "@/lib/scheduling-rules";
import { loadWeek, MIGRATION_ERROR_CODES } from "@/lib/auto-schedule-server";
import { generateSchedule, parseAdjustments, type GenerationRun } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
// The engine stops its search after a few seconds; leave room for the queries.
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MIGRATION_REQUIRED = {
  error: "Auto-schedule needs database migration 0034_auto_scheduler.sql",
  migrationRequired: true,
};

type RunRow = {
  id: number;
  week_start: string;
  mode: "fill" | "replace";
  seed: number | string;
  created_at: string;
  rules: GenerationRun["rules"];
  adjustments: GenerationRun["adjustments"];
  metrics: Pick<GenerationRun, "metrics" | "gaps" | "suggestions" | "warnings" | "employees">;
  undone_at: string | null;
  published_at: string | null;
};

function toRun(row: RunRow): GenerationRun {
  return {
    runId: row.id,
    weekStart: String(row.week_start).slice(0, 10),
    mode: row.mode,
    seed: Number(row.seed),
    createdAt: row.created_at,
    rules: row.rules,
    adjustments: row.adjustments ?? [],
    ...row.metrics,
  };
}

function authStatus(error: string) {
  return error === "Not authenticated" ? 401 : 403;
}

// GET /api/drafts/generate?weekStart= — the week's latest run that's still in
// effect (not undone, replaced or published), or null.
export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get("weekStart");
  if (!weekStart || !DATE_RE.test(weekStart) || !isDateKey(weekStart))
    return NextResponse.json({ error: "weekStart must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authStatus(authError) });

  const { data, error } = await supabase
    .from("schedule_generation_runs")
    .select("id, week_start, mode, seed, created_at, rules, adjustments, metrics, undone_at, published_at")
    .eq("org_id", orgId!)
    .eq("week_start", weekStart)
    .order("id", { ascending: false })
    .limit(10);
  if (error) {
    if (MIGRATION_ERROR_CODES.has(error.code)) return NextResponse.json({ run: null, migrationRequired: true });
    console.error("[api/drafts/generate]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const live = ((data ?? []) as RunRow[]).find((r) => !r.undone_at && !r.published_at);
  return NextResponse.json({ run: live ? toRun(live) : null });
}

// POST /api/drafts/generate { weekStart, mode, seed?, rules?, adjustments?, replaceRunId? }
//   mode "fill" keeps the week's drafts and schedules around them; "replace"
//   starts over (the removed drafts are kept on the run for undo).
//   replaceRunId makes another version of that run, swapping out only its drafts.
//   rules overrides the org's scheduling rules for this run only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { weekStart, mode, seed, rules: rulesPatch, adjustments: rawAdjustments, replaceRunId = null } = body;
  if (typeof weekStart !== "string" || !DATE_RE.test(weekStart) || !isDateKey(weekStart))
    return NextResponse.json({ error: "weekStart must be YYYY-MM-DD" }, { status: 400 });
  if (mode !== "fill" && mode !== "replace")
    return NextResponse.json({ error: "mode must be fill or replace" }, { status: 400 });
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647))
    return NextResponse.json({ error: "seed must be a non-negative 32-bit integer" }, { status: 400 });
  if (replaceRunId !== null && !Number.isInteger(replaceRunId))
    return NextResponse.json({ error: "replaceRunId must be an integer or null" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authStatus(authError) });

  const loaded = await loadWeek(supabase, orgId!, weekStart);
  if (loaded.error === "migration_required") return NextResponse.json(MIGRATION_REQUIRED, { status: 503 });
  if (loaded.error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  const week = loaded.week;

  const rules = rulesPatch === undefined ? { rules: week.rules, error: null } : applySchedulingRulesPatch(rulesPatch, week.rules);
  if (rules.error !== null) return NextResponse.json({ error: rules.error }, { status: 400 });
  const adjustments = parseAdjustments(rawAdjustments, week.dates, new Set(week.employees.map((e) => e.id)));
  if (adjustments.error !== null) return NextResponse.json({ error: adjustments.error }, { status: 400 });

  // What stays: published shifts, plus drafts the run doesn't replace. Drafts
  // outside the week always stay (they matter for rest and consecutive days).
  const inWeek = (date: string) => date >= week.dates[0] && date <= week.dates[6];
  const keptDrafts = week.drafts.filter((d) => {
    if (!inWeek(d.date)) return true;
    if (replaceRunId !== null) return d.generationRunId !== replaceRunId;
    return mode === "fill";
  });
  const runSeed: number = seed ?? Math.floor(Math.random() * 2_147_483_647);

  let result;
  try {
    result = generateSchedule({
      weekDates: week.dates,
      timezone: week.timezone,
      curves: week.curves,
      storeHours: week.storeHours,
      employees: week.employees,
      existing: [...week.published, ...keptDrafts],
      rules: rules.rules,
      adjustments: adjustments.adjustments,
      seed: runSeed,
    });
  } catch (e) {
    console.error("[api/drafts/generate] engine failed", e);
    return NextResponse.json({ error: "Couldn't generate a schedule" }, { status: 500 });
  }

  const summary = {
    metrics: result.metrics,
    gaps: result.gaps,
    suggestions: result.suggestions,
    warnings: result.warnings,
    employees: result.employees,
  };
  // The week's drafts as the engine saw them; the database refuses the write if they changed since.
  const expected = week.drafts
    .filter((d) => inWeek(d.date))
    .sort((a, b) => a.id - b.id)
    .map((d) => [d.id, d.employeeId, d.date, d.startMinutes, d.endMinutes]);

  const { data: applied, error: rpcError } = await supabase.rpc("apply_generated_drafts", {
    p_org: orgId,
    p_week_start: week.dates[0],
    p_mode: mode,
    p_replace_run_id: replaceRunId,
    p_expected: expected,
    p_rows: result.shifts.map((s) => ({
      employee_id: s.employeeId,
      date: s.date,
      start_minutes: s.startMinutes,
      end_minutes: s.endMinutes,
    })),
    p_seed: runSeed,
    p_rules: rules.rules,
    p_adjustments: adjustments.adjustments,
    p_metrics: summary,
  });
  if (rpcError) {
    if (MIGRATION_ERROR_CODES.has(rpcError.code)) return NextResponse.json(MIGRATION_REQUIRED, { status: 503 });
    console.error("[api/drafts/generate]", rpcError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  switch (applied?.status) {
    case "ok":
      break;
    case "forbidden":
      return NextResponse.json({ error: "Manager access required" }, { status: 403 });
    case "conflict":
      return NextResponse.json({ error: "The week's drafts changed while generating. Try again." }, { status: 409 });
    case "stale":
      return NextResponse.json({ error: "That version was already replaced, undone or published." }, { status: 409 });
    default:
      console.error("[api/drafts/generate] apply failed", applied);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const run: GenerationRun = {
    runId: applied.run_id,
    weekStart: week.dates[0],
    mode,
    seed: runSeed,
    createdAt: new Date().toISOString(),
    rules: rules.rules,
    adjustments: adjustments.adjustments,
    ...summary,
  };

  writeAuditLog({
    action:       "draft_schedule.generate",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "schedule_generation_run",
    resourceId:   String(applied.run_id),
    after: {
      inserted: applied.inserted,
      removed:  applied.removed,
      coverageScore: result.metrics.coverageScore,
    },
    metadata: {
      weekStart: week.dates[0],
      mode,
      seed: runSeed,
      replacedRunId: replaceRunId,
      adjustments: adjustments.adjustments.length,
    },
  }).catch(() => {});

  return NextResponse.json({ run, inserted: applied.inserted, removed: applied.removed });
}
