import { createAdminClient } from "@/lib/supabase-admin";
import { identifyAtKiosk, jsonResponse, recordKioskPunch } from "@/lib/kiosk-server";
import { PUNCH_TYPES, type PunchType } from "@/lib/kiosk";

export const dynamic = "force-dynamic";

// POST /api/kiosk/punch — { pin, punchType }. The PIN is checked again with
// the punch (the kiosk keeps no session), then the punch is written with
// source 'kiosk' under the same rules as POST /api/punches. Kiosk punches
// carry no GPS: the registered kiosk device is the proof of place.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  const { pin, punchType } = body as { pin?: unknown; punchType?: unknown };

  // Checked before the PIN, so a bad request doesn't cost an attempt.
  if (typeof punchType !== "string" || !PUNCH_TYPES.includes(punchType as PunchType))
    return jsonResponse({ error: "punchType must be one of: " + PUNCH_TYPES.join(", ") }, 400);

  const admin = createAdminClient();
  const { who, response } = await identifyAtKiosk(admin, request, pin);
  if (!who) return response;

  return recordKioskPunch(admin, who, punchType as PunchType);
}
