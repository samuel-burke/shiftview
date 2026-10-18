import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { notify, notifyManagers, type NotificationType } from "@/lib/notify";
import { sendNtfy } from "@/lib/ntfy";
import { fmtMinutes, type PunchType } from "@/data/types";
import { addDaysToKey, dateKeyInTz, formatDateKey, formatTimeInTz, resolveTimezone, todayKeyInTz } from "@/lib/dates";
import { PAY_RULE_KEYS, parsePayRules } from "@/lib/pay-rules";
import { parsePunchPolicy } from "@/lib/punch-policy";
import {
  findMissedClockOuts,
  findNoShows,
  isApproachingOvertime,
  projectWeeklyHours,
} from "@/lib/attendance-alerts";
import type { TimecardCalloutInput, TimecardPunchInput, TimecardScheduleInput } from "@/lib/timecard";

export const dynamic = "force-dynamic";

const ALERT_TYPES: NotificationType[] = ["no_show", "missed_clock_out", "overtime_warning"];
const DAY_MS = 86_400_000;

// Settings the checks read: the store timezone and the no-call-no-show policy.
const SETTING_KEYS = ["timezone", "punch_ncns_enabled", "punch_ncns_minutes", PAY_RULE_KEYS.workweekStartDay];

// GET /api/cron/attendance — run every 15 minutes. For each organization, in
// its store timezone, alerts:
//   * managers when a scheduled employee is a no-call-no-show;
//   * the employee and managers when a shift is left open past its end;
//   * managers when an employee is on course for weekly overtime.
// Each alert goes out once: it carries an `alertKey` in its notification data,
// and a key already in the notifications table is never sent again.
// Never clocks anyone out — that stays a manager's (or a policy's) decision.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowMs = Date.now();

  const fail = async (what: string, err: unknown) => {
    console.error(`[cron/attendance] ${what} failed:`, err);
    await sendNtfy({
      title: "Attendance alert cron failed",
      message: `${what} failed, so no no-show, missed clock-out or overtime alerts went out. Check the server logs.`,
      tags: ["warning"],
      priority: 4,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  };

  // Demo tenants are seeded sample data; nobody needs alerts about them.
  const { data: orgRows, error: orgErr } = await fetchAllRows<{ id: string; is_demo: boolean }>((a, b) =>
    supabase.from("organizations").select("id, is_demo").order("id").range(a, b)
  );
  if (orgErr) return fail("Fetching organizations", orgErr);
  const orgIds = new Set(orgRows.filter((o) => !o.is_demo).map((o) => o.id));
  if (orgIds.size === 0) return NextResponse.json({ noShows: 0, missedClockOuts: 0, overtime: 0 });

  const { data: settingRows, error: settingsErr } = await fetchAllRows<{ org_id: string; key: string; value: string }>((a, b) =>
    supabase
      .from("app_settings")
      .select("org_id, key, value")
      .in("key", SETTING_KEYS)
      .order("org_id")
      .order("key")
      .range(a, b)
  );
  if (settingsErr) return fail("Fetching settings", settingsErr);
  const settingsByOrg = new Map<string, Record<string, string>>();
  for (const r of settingRows) {
    settingsByOrg.set(r.org_id, { ...settingsByOrg.get(r.org_id), [r.key]: r.value });
  }

  // One read per table for every org. Each org needs its workweek (which
  // starts at most 6 days back) plus a day either side, in its own timezone;
  // UTC today ± 9 days covers that for any zone, and each org's checks only
  // look at their own days.
  const utcToday = todayKeyInTz("UTC", nowMs);
  const fromDate = addDaysToKey(utcToday, -9);
  const toDate = addDaysToKey(utcToday, 9);
  const punchesSince = new Date(nowMs - 10 * DAY_MS).toISOString();

  const [schedRes, punchRes, calloutRes, empRes, sentRes] = await Promise.all([
    fetchAllRows<{ id: number; org_id: string; employee_id: number; date: string; start_minutes: number; end_minutes: number }>((a, b) =>
      supabase
        .from("schedules")
        .select("id, org_id, employee_id, date, start_minutes, end_minutes")
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("id")
        .range(a, b)
    ),
    fetchAllRows<{ id: number; org_id: string; employee_id: number; punch_type: string; punched_at: string }>((a, b) =>
      supabase
        .from("punch_records")
        .select("id, org_id, employee_id, punch_type, punched_at")
        .gte("punched_at", punchesSince)
        .order("id")
        .range(a, b)
    ),
    fetchAllRows<{ id: number; org_id: string; employee_id: number; date: string }>((a, b) =>
      supabase
        .from("callouts")
        .select("id, org_id, employee_id, date")
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("id")
        .range(a, b)
    ),
    // exempt (migration 0060): salaried staff get no overtime, so no overtime
    // alert. Before that migration the column is missing: nobody is exempt.
    (async () => {
      type Emp = { id: number; org_id: string; name: string; user_id: string | null; exempt?: boolean };
      const read = (columns: string) =>
        fetchAllRows<Emp>((a, b) => supabase.from("employees").select(columns).order("id").range(a, b) as never);
      const withExempt = await read("id, org_id, name, user_id, exempt");
      if ((withExempt.error as { code?: string } | null)?.code !== "42703") return withExempt;
      return read("id, org_id, name, user_id");
    })(),
    // Alerts already sent. An alert is due at most ALERT_LOOKBACK_MS after
    // its event and an overtime alert is once per workweek, so 8 days back
    // holds every key that could repeat.
    fetchAllRows<{ id: number; org_id: string; data: { alertKey?: unknown } | null }>((a, b) =>
      supabase
        .from("notifications")
        .select("id, org_id, data")
        .in("type", ALERT_TYPES)
        .gte("created_at", new Date(nowMs - 8 * DAY_MS).toISOString())
        .order("id")
        .range(a, b)
    ),
  ]);
  if (schedRes.error) return fail("Fetching schedules", schedRes.error);
  if (punchRes.error) return fail("Fetching punches", punchRes.error);
  if (calloutRes.error) return fail("Fetching call-outs", calloutRes.error);
  if (empRes.error) return fail("Fetching employees", empRes.error);
  if (sentRes.error) return fail("Fetching sent alerts", sentRes.error);

  const sent = new Set(
    sentRes.data
      .filter((n) => typeof n.data?.alertKey === "string")
      .map((n) => `${n.org_id}|${n.data!.alertKey}`)
  );

  // Everything grouped by employee. Employee ids are only unique per org, so
  // the org is part of the key.
  type EmpData = {
    schedules: TimecardScheduleInput[];
    punches: TimecardPunchInput[];
    callouts: TimecardCalloutInput[];
  };
  const byEmp = new Map<string, EmpData>();
  const empData = (orgId: string, empId: number) => {
    const k = `${orgId}|${empId}`;
    let d = byEmp.get(k);
    if (!d) byEmp.set(k, (d = { schedules: [], punches: [], callouts: [] }));
    return d;
  };
  for (const s of schedRes.data) {
    if (!orgIds.has(s.org_id)) continue;
    empData(s.org_id, s.employee_id).schedules.push({ date: s.date, startMinutes: s.start_minutes, endMinutes: s.end_minutes });
  }
  for (const p of punchRes.data) {
    if (!orgIds.has(p.org_id)) continue;
    empData(p.org_id, p.employee_id).punches.push({ id: p.id, punchType: p.punch_type as PunchType, punchedAt: p.punched_at });
  }
  for (const c of calloutRes.data) {
    if (!orgIds.has(c.org_id)) continue;
    empData(c.org_id, c.employee_id).callouts.push({ date: c.date });
  }
  const employees = new Map(empRes.data.map((e) => [`${e.org_id}|${e.id}`, e]));

  let noShows = 0;
  let missedClockOuts = 0;
  let overtime = 0;

  for (const [key, data] of byEmp) {
    const employee = employees.get(key);
    if (!employee) continue; // deleted since its rows were written
    const orgId = employee.org_id;
    const settings = settingsByOrg.get(orgId) ?? {};
    const tz = resolveTimezone(settings.timezone);
    const policy = parsePunchPolicy(settings);
    const name = employee.name;
    const today = todayKeyInTz(tz, nowMs);

    // Sends unless this alert has gone out before. Notification failures are
    // logged inside notify(); one bad send must not stop the rest.
    const once = async (alertKey: string, send: (data: Record<string, unknown>) => Promise<void>) => {
      if (sent.has(`${orgId}|${alertKey}`)) return false;
      sent.add(`${orgId}|${alertKey}`);
      await send({ alertKey, employeeId: employee.id }).catch((err) =>
        console.error("[cron/attendance] notify failed:", err)
      );
      return true;
    };

    for (const ns of findNoShows({ timezone: tz, policy, nowMs, ...data })) {
      const when = ns.date === today ? "their" : "yesterday's";
      const ok = await once(`no_show:${employee.id}:${ns.date}:${ns.startMinutes}`, (d) =>
        notifyManagers(
          orgId,
          "no_show",
          "No-Show",
          `${name} hasn't clocked in for ${when} ${fmtMinutes(ns.startMinutes)} shift`,
          { ...d, date: ns.date, startMinutes: ns.startMinutes }
        )
      );
      if (ok) noShows++;
    }

    for (const mc of findMissedClockOuts({ timezone: tz, nowMs, schedules: data.schedules, punches: data.punches })) {
      const since = formatTimeInTz(mc.clockInMs, tz);
      const inDay = dateKeyInTz(mc.clockInMs, tz);
      const sinceDay =
        inDay === today ? "" :
        inDay === addDaysToKey(today, -1) ? " yesterday" :
        ` on ${formatDateKey(inDay, { weekday: "long" })}`;
      const ok = await once(`missed_clock_out:${employee.id}:${mc.clockInId}`, async (d) => {
        const extra = { ...d, clockInId: mc.clockInId, date: mc.shift?.date ?? null };
        await notifyManagers(
          orgId,
          "missed_clock_out",
          "Missed Clock-Out",
          `${name} is still clocked in from ${since}${sinceDay} — they may have forgotten to clock out`,
          extra
        );
        if (employee.user_id) {
          await notify({
            orgId,
            userId: employee.user_id,
            type: "missed_clock_out",
            title: "Still clocked in?",
            body: `You've been clocked in since ${since}${sinceDay}. If you've left, clock out or ask your manager to fix your time.`,
            data: extra,
          });
        }
      });
      if (ok) missedClockOuts++;
    }

    if (employee.exempt === true) continue; // no overtime to warn about
    const projection = projectWeeklyHours({
      timezone: tz, nowMs, workweekStartDay: parsePayRules(settings).workweekStartDay, ...data,
    });
    if (isApproachingOvertime(projection)) {
      const body =
        projection.remainingScheduledHours > 0
          ? `${name} has worked ${projection.workedHours}h this week and is scheduled for ${projection.remainingScheduledHours}h more (${projection.projectedHours}h total)`
          : `${name} has worked ${projection.workedHours}h this week`;
      const ok = await once(`overtime_warning:${employee.id}:${projection.weekStart}`, (d) =>
        notifyManagers(orgId, "overtime_warning", "Approaching Overtime", body, {
          ...d,
          weekStart: projection.weekStart,
          workedHours: projection.workedHours,
          projectedHours: projection.projectedHours,
        })
      );
      if (ok) overtime++;
    }
  }

  return NextResponse.json({ noShows, missedClockOuts, overtime });
}
