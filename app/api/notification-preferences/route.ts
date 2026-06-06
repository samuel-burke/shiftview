import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  latePunchAlerts: true,
  messageAlerts: true,
  chessAlerts: true,
  ptoAlerts: true,
  newShiftAlerts: true,
  shiftChangeAlerts: true,
  swapAlerts: true,
  shiftReminderAlerts: true,
};

const FIELD_MAP = [
  ["latePunchAlerts",    "late_punch_alerts"],
  ["messageAlerts",      "message_alerts"],
  ["chessAlerts",        "chess_alerts"],
  ["ptoAlerts",          "pto_alerts"],
  ["newShiftAlerts",     "new_shift_alerts"],
  ["shiftChangeAlerts",  "shift_change_alerts"],
  ["swapAlerts",         "swap_alerts"],
  ["shiftReminderAlerts","shift_reminder_alerts"],
] as const;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json(DEFAULTS);

  const { data, error } = await supabase
    .from("user_notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[notification-preferences GET]", error);
    return NextResponse.json(DEFAULTS);
  }

  if (!data) return NextResponse.json(DEFAULTS);

  return NextResponse.json({
    latePunchAlerts:     data.late_punch_alerts    ?? DEFAULTS.latePunchAlerts,
    messageAlerts:       data.message_alerts       ?? DEFAULTS.messageAlerts,
    chessAlerts:         data.chess_alerts         ?? DEFAULTS.chessAlerts,
    ptoAlerts:           data.pto_alerts           ?? DEFAULTS.ptoAlerts,
    newShiftAlerts:      data.new_shift_alerts     ?? DEFAULTS.newShiftAlerts,
    shiftChangeAlerts:   data.shift_change_alerts  ?? DEFAULTS.shiftChangeAlerts,
    swapAlerts:          data.swap_alerts          ?? DEFAULTS.swapAlerts,
    shiftReminderAlerts: data.shift_reminder_alerts ?? DEFAULTS.shiftReminderAlerts,
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const update: Record<string, boolean | string> = {};

  for (const [jsKey, dbKey] of FIELD_MAP) {
    if (body[jsKey] !== undefined) {
      if (typeof body[jsKey] !== "boolean")
        return NextResponse.json({ error: `${jsKey} must be a boolean` }, { status: 400 });
      update[dbKey] = body[jsKey];
    }
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

  const { error } = await supabase
    .from("user_notification_preferences")
    .upsert({ user_id: user.id, ...update, updated_at: new Date().toISOString() });

  if (error) {
    console.error("[notification-preferences PUT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
