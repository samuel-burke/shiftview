import { createAdminClient } from "@/lib/supabase-admin";
import { clearKioskCookieHeader, hashKioskToken, jsonResponse, kioskTokenFromRequest } from "@/lib/kiosk-server";
import { identifyFailure } from "@/lib/kiosk";

export const dynamic = "force-dynamic";

// GET /api/kiosk/status — is this device a working kiosk? No sign-in: the
// device's kiosk cookie is the credential. Answers with the kiosk's and
// store's names only.
export async function GET(request: Request) {
  const token = kioskTokenFromRequest(request);
  if (!token) {
    const f = identifyFailure({ status: "no_kiosk" });
    return jsonResponse(f.body, f.status);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("kiosk_status", { p_token_hash: hashKioskToken(token) });
  if (error || !data || typeof data !== "object") {
    console.error("[api/kiosk/status]", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  const r = data as { status: string; kiosk_name?: string; org_name?: string };
  if (r.status === "ok") return jsonResponse({ kioskName: r.kiosk_name, orgName: r.org_name });
  if (r.status === "disabled") {
    const f = identifyFailure({ status: "disabled" });
    return jsonResponse(f.body, f.status);
  }
  // Revoked or unknown: the cookie is useless, so drop it.
  const f = identifyFailure({ status: "no_kiosk" });
  return jsonResponse(f.body, f.status, { "Set-Cookie": clearKioskCookieHeader(request) });
}
