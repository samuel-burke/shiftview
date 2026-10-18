import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { jsonResponse } from "@/lib/kiosk-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function authorize(request: Request, ctx: Ctx) {
  const { id: raw } = await ctx.params;
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0)
    return { response: jsonResponse({ error: "Invalid kiosk id" }, 400) } as const;
  const supabase = await createClient();
  const { user, orgId, error } = await requireManager(supabase, request);
  if (error) return { response: jsonResponse({ error }, error === "Not authenticated" ? 401 : 403) } as const;
  return { supabase, user, orgId: orgId!, id, response: null } as const;
}

// DELETE /api/kiosk/devices/:id — revoke a kiosk. Its token stops working at
// once; its punches keep their kiosk id.
export async function DELETE(request: Request, ctx: Ctx) {
  const a = await authorize(request, ctx);
  if (a.response) return a.response;

  const { data: found, error } = await a.supabase.rpc("kiosk_revoke", { p_org: a.orgId, p_id: a.id });
  if (error) {
    console.error("[api/kiosk/devices]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
  if (!found) return jsonResponse({ error: "Kiosk not found" }, 404);

  writeAuditLog({
    action: "kiosk.revoke", orgId: a.orgId, actorId: a.user?.id,
    resourceType: "kiosk", resourceId: String(a.id),
  }).catch(() => {});
  return jsonResponse({ ok: true });
}

// PATCH /api/kiosk/devices/:id — { unlock: true }: clear a lockout after
// too many wrong PINs.
export async function PATCH(request: Request, ctx: Ctx) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || (body as { unlock?: unknown }).unlock !== true)
    return jsonResponse({ error: "Send { unlock: true }" }, 400);

  const a = await authorize(request, ctx);
  if (a.response) return a.response;

  const { data: found, error } = await a.supabase.rpc("kiosk_unlock", { p_org: a.orgId, p_id: a.id });
  if (error) {
    console.error("[api/kiosk/devices]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
  if (!found) return jsonResponse({ error: "Kiosk not found" }, 404);

  writeAuditLog({
    action: "kiosk.unlock", orgId: a.orgId, actorId: a.user?.id,
    resourceType: "kiosk", resourceId: String(a.id),
  }).catch(() => {});
  return jsonResponse({ ok: true });
}
