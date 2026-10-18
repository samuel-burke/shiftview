import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { syncAccruals } from "@/lib/pto-server";

export const dynamic = "force-dynamic";

// POST /api/pto/accruals — managers. Brings every employee's accruals up to
// date through yesterday (store time), from worked hours as payroll counts
// them, and applies the carryover cap at each year end. Idempotent: running
// it again posts only what changed (a fixed punch, a new week).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const tz = await getOrgTimezone(supabase, orgId!);
  const { results, error } = await syncAccruals(supabase, orgId!, tz, todayKeyInTz(tz));
  if (error === "Manager access required")
    return NextResponse.json({ error }, { status: 403 });
  if (error === "Too many punches to compute accruals")
    return NextResponse.json({ error }, { status: 422 });
  if (error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const posted = results.reduce((n, r) => n + r.accrualRows + r.carryoverRows, 0);
  if (posted > 0) {
    writeAuditLog({
      action:       "pto.accrue",
      orgId:        orgId!,
      actorId:      user?.id,
      resourceType: "pto_ledger",
      metadata:     { results },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, results });
}
