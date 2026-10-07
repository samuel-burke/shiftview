import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { writeAuditLogs, type AuditEntry } from "@/lib/audit";
import { isRequestExpired } from "@/lib/request-expiry";
import { swapDate } from "@/lib/swaps";
import { addDaysToKey, DEFAULT_TIMEZONE, resolveTimezone, todayKeyInTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

// Swaps still waiting on the coworker or a manager.
const OPEN_SWAP_STATUSES = ["pending", "accepted"];
// Ids per DELETE, keeping each request URL short.
const DELETE_BATCH = 100;

type Admin = ReturnType<typeof createAdminClient>;

// Nightly cleanup of requests nobody decided before their day arrived (see
// lib/request-expiry.ts): time off still pending, and swaps the coworker or a
// manager never got to. The API already hides and refuses them from the
// store's midnight on; this deletes them and notes each one in its org's audit
// log. Also invocable manually:
//   curl -H "x-cron-secret: $CRON_SECRET" <site>/api/cron/expire-requests
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // "Today" is per org, in each store's own timezone.
  const { data: tzRows, error: tzErr } = await admin
    .from("app_settings")
    .select("org_id, value")
    .eq("key", "timezone");
  if (tzErr) {
    console.error("[cron/expire-requests] timezones fetch failed:", tzErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const tzByOrg = new Map<string, string>(
    (tzRows ?? []).map((r: { org_id: string; value: string }) => [r.org_id, resolveTimezone(r.value)])
  );
  const expiredIn = (orgId: string, date: string) =>
    isRequestExpired(date, todayKeyInTz(tzByOrg.get(orgId) ?? DEFAULT_TIMEZONE));
  // No store's today is later than tomorrow in UTC.
  const latestToday = addDaysToKey(todayKeyInTz("UTC"), 1);

  const [timeOff, swaps] = await Promise.all([
    admin
      .from("time_off_requests")
      .select("id, org_id, employee_id, date")
      .eq("status", "pending")
      .lte("date", latestToday),
    admin
      .from("shift_swaps")
      .select(`
        id, org_id, status, requester_id, target_id,
        schedule_a:schedules!shift_swaps_schedule_a_id_fkey(date),
        schedule_b:schedules!shift_swaps_schedule_b_id_fkey(date)
      `)
      .in("status", OPEN_SWAP_STATUSES),
  ]);
  if (timeOff.error || swaps.error) {
    console.error("[cron/expire-requests] requests fetch failed:", timeOff.error ?? swaps.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const expiredTimeOff = (timeOff.data ?? []).filter((r) => expiredIn(r.org_id, r.date));
  const expiredSwaps = (swaps.data ?? []).flatMap((s) => {
    const date = swapDate(s);
    return date !== null && expiredIn(s.org_id, date) ? [{ ...s, date }] : [];
  });

  // The DELETEs re-check the status, so a request decided since the reads
  // above is left alone.
  const timeOffResult = await deleteByIds(admin, "time_off_requests", expiredTimeOff.map((r) => r.id), ["pending"]);
  const swapResult = await deleteByIds(admin, "shift_swaps", expiredSwaps.map((s) => s.id), OPEN_SWAP_STATUSES);
  const deletedTimeOff = expiredTimeOff.filter((r) => timeOffResult.deleted.has(r.id));
  const deletedSwaps = expiredSwaps.filter((s) => swapResult.deleted.has(s.id));

  // Names go in the audit metadata, as the API's own entries do. Employee ids
  // are only unique per org, so key by both.
  const employeeIds = [
    ...new Set([
      ...deletedTimeOff.map((r) => r.employee_id),
      ...deletedSwaps.flatMap((s) => [s.requester_id, s.target_id]),
    ]),
  ];
  const names = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await admin.from("employees").select("id, org_id, name").in("id", employeeIds);
    for (const e of employees ?? []) names.set(`${e.org_id}:${e.id}`, e.name);
  }
  const nameOf = (orgId: string, employeeId: number) => names.get(`${orgId}:${employeeId}`) ?? null;

  const entries: AuditEntry[] = [
    ...deletedTimeOff.map((r): AuditEntry => ({
      action:       "time_off.expire",
      orgId:        r.org_id,
      resourceType: "time_off_request",
      resourceId:   String(r.id),
      before:       { status: "pending" },
      metadata: {
        employeeId:   r.employee_id,
        employeeName: nameOf(r.org_id, r.employee_id),
        date:         r.date,
      },
    })),
    ...deletedSwaps.map((s): AuditEntry => ({
      action:       "swap.expire",
      orgId:        s.org_id,
      resourceType: "shift_swap",
      resourceId:   String(s.id),
      before:       { status: s.status },
      metadata: {
        requesterId:   s.requester_id,
        requesterName: nameOf(s.org_id, s.requester_id),
        targetId:      s.target_id,
        targetName:    nameOf(s.org_id, s.target_id),
        date:          s.date,
      },
    })),
  ];
  await writeAuditLogs(entries);

  if (timeOffResult.failed || swapResult.failed) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ timeOff: deletedTimeOff.length, swaps: deletedSwaps.length });
}

// Deletes the given rows, if still in one of `statuses`, in batches. Returns
// the ids actually deleted; stops at the first failing batch.
async function deleteByIds(admin: Admin, table: string, ids: number[], statuses: string[]) {
  const deleted = new Set<number>();
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const { data, error } = await admin
      .from(table)
      .delete()
      .in("id", ids.slice(i, i + DELETE_BATCH))
      .in("status", statuses)
      .select("id");
    if (error) {
      console.error(`[cron/expire-requests] ${table} delete failed:`, error);
      return { deleted, failed: true };
    }
    for (const row of data ?? []) deleted.add(row.id);
  }
  return { deleted, failed: false };
}
