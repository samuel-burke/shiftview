import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrgAll } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { loadPtoPolicies } from "@/lib/pto-server";
import { LEAVE_TYPES, POLICY_SETTING_KEYS, validatePolicy, type PtoPolicies } from "@/lib/pto";

export const dynamic = "force-dynamic";

// GET /api/pto/policy — the org's PTO and sick accrual policies (any member).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error)
    return NextResponse.json({ error }, { status: error === "Not authenticated" ? 401 : 403 });
  return NextResponse.json({ policies: await loadPtoPolicies(supabase, ctx.orgId) });
}

// PUT /api/pto/policy { pto?: {...}, sick?: {...} } — managers. Each is a
// patch over the stored policy (lib/pto.ts validatePolicy). Turning a policy
// on, or changing its rate, starts accrual today.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const current = await loadPtoPolicies(supabase, orgId!);
  const today = todayKeyInTz(await getOrgTimezone(supabase, orgId!));
  const next: PtoPolicies = { ...current };
  const rows: { key: string; value: string }[] = [];
  for (const t of LEAVE_TYPES) {
    if (body[t] === undefined) continue;
    const r = validatePolicy(body[t], current[t], today);
    if (r.error !== null) return NextResponse.json({ error: `${t}: ${r.error}` }, { status: 400 });
    next[t] = r.policy;
    rows.push({ key: POLICY_SETTING_KEYS[t], value: JSON.stringify(r.policy) });
  }
  if (rows.length === 0)
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

  const { error } = await supabase.from("app_settings").upsert(withOrgAll(orgId!, rows));
  if (error) {
    console.error("[api/pto/policy]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "settings.update",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "app_settings",
    after:        Object.fromEntries(rows.map((r) => [r.key, r.value])),
    metadata:     { changedKeys: rows.map((r) => r.key) },
  }).catch(() => {});

  return NextResponse.json({ ok: true, policies: next });
}
