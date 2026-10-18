import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { getOrgTimezone } from "@/lib/org-timezone";
import { isDateKey, todayKeyInTz } from "@/lib/dates";
import { PAY_RATE_COLUMNS, PAY_RATE_HISTORY_TABLE, RATE_BEGINNING, toPayRateRows } from "@/lib/pay-rates";

export const dynamic = "force-dynamic";

// Pay-rate history of one employee (migration 0061), managers only. RLS on
// employee_pay_rates enforces the same.
//
//   GET    → { rates: [{ id, positionId, effectiveFrom, hourlyRate }], today }
//            newest first.
//   POST   { hourlyRate, effectiveFrom?, positionId? }
//            A new rate from effectiveFrom (store-local date, default today):
//            earlier days keep the rate they had. Same employee, position and
//            date again replaces that row's rate. hourlyRate null (base rate
//            only) means no rate from that date.
//   DELETE ?rateId=N removes one row (a mistaken entry).

const MAX_RATE = 99_999.99;
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function authorize(request: Request) {
  const supabase = await createClient();
  const { user, orgId, error } = await requireManager(supabase, request);
  if (error)
    return { error: NextResponse.json({ error }, { status: error === "Not authenticated" ? 401 : 403 }) } as const;
  return { supabase, user: user!, orgId: orgId! } as const;
}

async function employeeInOrg(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, id: number) {
  const { data } = await supabase.from("employees").select("id, name").eq("org_id", orgId).eq("id", id).maybeSingle();
  return data as { id: number; name: string } | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (id == null) return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { supabase, orgId } = auth;

  if (!(await employeeInOrg(supabase, orgId, id)))
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data, error } = await supabase
    .from(PAY_RATE_HISTORY_TABLE)
    .select(PAY_RATE_COLUMNS)
    .eq("org_id", orgId)
    .eq("employee_id", id)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    console.error("[api/employees/pay-rates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const tz = await getOrgTimezone(supabase, orgId);
  return NextResponse.json({
    rates: toPayRateRows(data).map((r) => ({
      id: r.id, positionId: r.positionId, effectiveFrom: r.effectiveFrom, hourlyRate: r.hourlyRate,
    })),
    today: todayKeyInTz(tz),
    beginning: RATE_BEGINNING,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (id == null) return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { hourlyRate, effectiveFrom, positionId } = body ?? {};

  if (positionId !== undefined && positionId !== null && !(Number.isInteger(positionId) && (positionId as number) > 0))
    return NextResponse.json({ error: "positionId must be a positive integer or null" }, { status: 400 });
  const position = (positionId as number | null | undefined) ?? null;
  if (hourlyRate === null) {
    if (position != null)
      return NextResponse.json({ error: "A position rate needs an hourly rate; delete it to stop using it" }, { status: 400 });
  } else if (typeof hourlyRate !== "number" || !Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > MAX_RATE) {
    return NextResponse.json({ error: `hourlyRate must be a number from 0 to ${MAX_RATE}, or null` }, { status: 400 });
  } else if (Math.abs(hourlyRate * 100 - Math.round(hourlyRate * 100)) > 1e-6) {
    return NextResponse.json({ error: "hourlyRate must be in whole cents" }, { status: 400 });
  }
  if (effectiveFrom !== undefined && !isDateKey(effectiveFrom))
    return NextResponse.json({ error: "effectiveFrom must be YYYY-MM-DD" }, { status: 400 });

  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { supabase, user, orgId } = auth;

  const employee = await employeeInOrg(supabase, orgId, id);
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const from = (effectiveFrom as string | undefined) ?? todayKeyInTz(await getOrgTimezone(supabase, orgId));
  const row = {
    org_id: orgId,
    employee_id: id,
    position_id: position,
    effective_from: from,
    hourly_rate: hourlyRate as number | null,
  };
  const { data, error } = await supabase
    .from(PAY_RATE_HISTORY_TABLE)
    .upsert(row, { onConflict: "employee_id,position_id,effective_from" })
    .select(PAY_RATE_COLUMNS)
    .maybeSingle();
  if (error?.code === FOREIGN_KEY_VIOLATION)
    return NextResponse.json({ error: "Position not found" }, { status: 400 });
  if (error?.code === UNIQUE_VIOLATION)
    return NextResponse.json({ error: "There is already a rate from that date" }, { status: 409 });
  if (error) {
    console.error("[api/employees/pay-rates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.pay_rate",
    orgId,
    actorId:      user.id,
    resourceType: "employee",
    resourceId:   String(id),
    after:        { hourlyRate, effectiveFrom: from, positionId: position },
    metadata:     { employeeId: id, employeeName: employee.name },
  }).catch(() => {});

  const [saved] = toPayRateRows(data ? [data] : []);
  return NextResponse.json({
    ok: true,
    rate: saved
      ? { id: saved.id, positionId: saved.positionId, effectiveFrom: saved.effectiveFrom, hourlyRate: saved.hourlyRate }
      : null,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (id == null) return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  const rateId = Number(new URL(request.url).searchParams.get("rateId"));
  if (!Number.isInteger(rateId) || rateId <= 0)
    return NextResponse.json({ error: "rateId must be a positive integer" }, { status: 400 });

  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { supabase, user, orgId } = auth;

  const { data, error } = await supabase
    .from(PAY_RATE_HISTORY_TABLE)
    .delete()
    .eq("org_id", orgId)
    .eq("employee_id", id)
    .eq("id", rateId)
    .select(PAY_RATE_COLUMNS);
  if (error) {
    console.error("[api/employees/pay-rates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const [removed] = toPayRateRows(data);
  if (!removed) return NextResponse.json({ error: "Rate not found" }, { status: 404 });

  writeAuditLog({
    action:       "employee.pay_rate_delete",
    orgId,
    actorId:      user.id,
    resourceType: "employee",
    resourceId:   String(id),
    before:       { hourlyRate: removed.hourlyRate, effectiveFrom: removed.effectiveFrom, positionId: removed.positionId },
    metadata:     { employeeId: id },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
