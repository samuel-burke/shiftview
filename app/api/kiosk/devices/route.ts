import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { hashKioskToken, jsonResponse, kioskCookieHeader, newKioskToken } from "@/lib/kiosk-server";
import { KIOSK_NAME_MAX } from "@/lib/kiosk";

export const dynamic = "force-dynamic";

type KioskRow = {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  locked: boolean;
  failed_today: number;
};

function authFailure(error: string) {
  return jsonResponse({ error }, error === "Not authenticated" ? 401 : 403);
}

// GET /api/kiosk/devices — managers: whether kiosk mode is on, and the
// store's kiosks (never their tokens).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { orgId, error } = await requireManager(supabase, request);
  if (error) return authFailure(error);

  const [{ data: setting }, { data: rows, error: listError }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("org_id", orgId!).eq("key", "kiosk_enabled").maybeSingle(),
    supabase.rpc("kiosk_list", { p_org: orgId! }),
  ]);
  if (listError) {
    console.error("[api/kiosk/devices]", listError);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  return jsonResponse({
    enabled: setting?.value === "true",
    devices: ((rows ?? []) as KioskRow[]).map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      locked: k.locked,
      failedToday: k.failed_today,
    })),
  });
}

// POST /api/kiosk/devices — { name }. Managers register the device they are
// on as a kiosk: the new token goes into this browser's kiosk cookie and is
// never shown or stored anywhere else.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  const name = typeof (body as { name?: unknown }).name === "string" ? (body as { name: string }).name.trim() : "";
  if (!name || name.length > KIOSK_NAME_MAX)
    return jsonResponse({ error: `Give the kiosk a name (up to ${KIOSK_NAME_MAX} characters)` }, 400);

  const supabase = await createClient();
  const { user, orgId, error } = await requireManager(supabase, request);
  if (error) return authFailure(error);

  const token = newKioskToken();
  const { data: id, error: createError } = await supabase.rpc("kiosk_create", {
    p_org: orgId!,
    p_name: name,
    p_token_hash: hashKioskToken(token),
  });
  if (createError || id == null) {
    if (createError?.code === "54000") return jsonResponse({ error: createError.message }, 409);
    if (createError?.code === "42501") return jsonResponse({ error: "Manager access required" }, 403);
    console.error("[api/kiosk/devices]", createError);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  writeAuditLog({
    action:       "kiosk.create",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "kiosk",
    resourceId:   String(id),
    after:        { name },
  }).catch(() => {});

  return jsonResponse({ id: Number(id), name }, 201, { "Set-Cookie": kioskCookieHeader(token, request) });
}
