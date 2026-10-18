import { createAdminClient } from "@/lib/supabase-admin";
import { identifyAtKiosk, jsonResponse, kioskShiftView } from "@/lib/kiosk-server";

export const dynamic = "force-dynamic";

// POST /api/kiosk/identify — { pin }. No sign-in: the device's kiosk cookie
// and the PIN are the credentials. Answers with the PIN owner's name, their
// clock state and the punches they can make, and nothing about anyone else.
// Wrong PINs count toward the kiosk's lockout (migration 0063).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return jsonResponse({ error: "Invalid JSON body" }, 400);

  const admin = createAdminClient();
  const { who, response } = await identifyAtKiosk(admin, request, (body as { pin?: unknown }).pin);
  if (!who) return response;

  const view = await kioskShiftView(admin, who);
  if (!view) return jsonResponse({ error: "Internal server error" }, 500);
  return jsonResponse(view);
}
