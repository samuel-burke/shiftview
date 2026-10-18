import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { jsonResponse } from "@/lib/kiosk-server";

export const dynamic = "force-dynamic";

// /api/kiosk/pin — an employee's kiosk PIN, for the employee themselves or a
// manager of the store. The database functions (migration 0063) decide who
// may: an employee only reaches their own PIN, a manager anyone's in their
// store. A PIN is never returned except the one just generated.
//
//   GET    ?employeeId=     → { hasPin, updatedAt }
//   PUT    { employeeId?, pin } → set a chosen PIN
//   POST   { employeeId? }  → generate a random 6-digit PIN → { pin }
//   DELETE ?employeeId=     → remove the PIN
//
// employeeId defaults to the caller's own employee record.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function resolve(request: Request, rawEmployeeId: unknown) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated") return { response: jsonResponse({ error }, 401) } as const;
  if (error) return { response: jsonResponse({ error }, 403) } as const;

  let employeeId: number | null;
  if (rawEmployeeId === undefined || rawEmployeeId === null || rawEmployeeId === "") {
    employeeId = ctx.employeeId;
  } else {
    const n = typeof rawEmployeeId === "number" ? rawEmployeeId
      : typeof rawEmployeeId === "string" && /^\d{1,15}$/.test(rawEmployeeId) ? Number(rawEmployeeId) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0)
      return { response: jsonResponse({ error: "employeeId must be a positive integer" }, 400) } as const;
    employeeId = n;
  }
  if (!employeeId)
    return { response: jsonResponse({ error: "No employee record linked to this account" }, 403) } as const;
  // Only a manager names someone else; the database checks this as well.
  if (employeeId !== ctx.employeeId && !ctx.isManager)
    return { response: jsonResponse({ error: "You can only change your own PIN" }, 403) } as const;

  return { supabase, ctx, employeeId, response: null } as const;
}

function dbError(error: { code?: string; message?: string }, where: string): Response {
  if (error.code === "42501") return jsonResponse({ error: "You can only change your own PIN" }, 403);
  if (error.code === "P0002") return jsonResponse({ error: "Employee not found" }, 404);
  if (error.code === "22023") return jsonResponse({ error: error.message ?? "Invalid PIN" }, 400);
  if (error.code === "23505") return jsonResponse({ error: "That PIN is taken — choose another" }, 409);
  console.error(`[api/kiosk/pin] ${where}`, error);
  return jsonResponse({ error: "Internal server error" }, 500);
}

function audit(supabaseCtx: { orgId: string; user: { id: string } }, action: string, employeeId: number) {
  writeAuditLog({
    action,
    orgId: supabaseCtx.orgId,
    actorId: supabaseCtx.user.id,
    resourceType: "employee",
    resourceId: String(employeeId),
    metadata: { employeeId },
  }).catch(() => {});
}

export async function GET(request: Request) {
  const r = await resolve(request, new URL(request.url).searchParams.get("employeeId"));
  if (r.response) return r.response;
  const { data, error } = await (r.supabase as Supabase).rpc("employee_pin_status", {
    p_org: r.ctx.orgId, p_employee: r.employeeId,
  });
  if (error) return dbError(error, "status");
  const s = (data ?? {}) as { hasPin?: boolean; updatedAt?: string | null };
  return jsonResponse({ hasPin: !!s.hasPin, updatedAt: s.updatedAt ?? null });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return jsonResponse({ error: "Invalid JSON body" }, 400);
  const { employeeId, pin } = body as { employeeId?: unknown; pin?: unknown };
  if (typeof pin !== "string") return jsonResponse({ error: "A PIN must be 4 to 6 digits" }, 400);

  const r = await resolve(request, employeeId);
  if (r.response) return r.response;
  const { data, error } = await (r.supabase as Supabase).rpc("set_employee_pin", {
    p_org: r.ctx.orgId, p_employee: r.employeeId, p_pin: pin,
  });
  if (error) return dbError(error, "set");
  if (data === "taken") return jsonResponse({ error: "That PIN is taken — choose another" }, 409);
  if (data === "too_many")
    return jsonResponse({ error: "Too many taken PINs today — use Generate a PIN instead" }, 429);
  if (data !== "ok") {
    console.error("[api/kiosk/pin] set: unexpected", data);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
  audit(r.ctx, "kiosk.pin_set", r.employeeId);
  return jsonResponse({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const employeeId = typeof body === "object" && body !== null ? (body as { employeeId?: unknown }).employeeId : undefined;

  const r = await resolve(request, employeeId);
  if (r.response) return r.response;
  const { data, error } = await (r.supabase as Supabase).rpc("generate_employee_pin", {
    p_org: r.ctx.orgId, p_employee: r.employeeId,
  });
  if (error) return dbError(error, "generate");
  if (typeof data !== "string" || !/^\d{6}$/.test(data)) {
    console.error("[api/kiosk/pin] generate: unexpected", data);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
  audit(r.ctx, "kiosk.pin_set", r.employeeId);
  return jsonResponse({ pin: data }, 201);
}

export async function DELETE(request: Request) {
  const r = await resolve(request, new URL(request.url).searchParams.get("employeeId"));
  if (r.response) return r.response;
  const { error } = await (r.supabase as Supabase).rpc("clear_employee_pin", {
    p_org: r.ctx.orgId, p_employee: r.employeeId,
  });
  if (error) return dbError(error, "clear");
  audit(r.ctx, "kiosk.pin_cleared", r.employeeId);
  return jsonResponse({ ok: true });
}
