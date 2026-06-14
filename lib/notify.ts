import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPush, type PushPayload } from "./webpush";
import { isDemoOrgId } from "./demo-org";

export type NotificationType =
  | "shift_change"
  | "shift_reminder"
  | "swap_approved"
  | "swap_denied"
  | "pto_approved"
  | "pto_denied"
  | "late_clock_in"
  | "schedule_published"
  | "message"
  | "chess_move";

type PushPrefKey =
  | "late_punch_alerts"
  | "message_alerts"
  | "pto_alerts"
  | "new_shift_alerts"
  | "shift_change_alerts"
  | "swap_alerts"
  | "shift_reminder_alerts"
  | "chess_alerts";

const TYPE_TO_PREF: Record<NotificationType, PushPrefKey> = {
  late_clock_in:      "late_punch_alerts",
  message:            "message_alerts",
  chess_move:         "chess_alerts",
  pto_approved:       "pto_alerts",
  pto_denied:         "pto_alerts",
  schedule_published: "new_shift_alerts",
  shift_change:       "shift_change_alerts",
  swap_approved:      "swap_alerts",
  swap_denied:        "swap_alerts",
  shift_reminder:     "shift_reminder_alerts",
};

export type NotifyOptions = {
  // Organization the notification belongs to; always resolved server-side via
  // getOrgContext()/requireManager(), never taken from client input.
  orgId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

// Insert a notification and fire push to all subscriptions for that user.
// Caller supplies their own supabase client (RLS applies; SECURITY DEFINER
// functions narrow the blast radius to the minimum required operations).
export async function notify(
  supabase: SupabaseClient,
  options: NotifyOptions
): Promise<void> {
  const { error: insertError } = await supabase.rpc("notify_insert", {
    p_org_id:  options.orgId,
    p_user_id: options.userId,
    p_type:    options.type,
    p_title:   options.title,
    p_body:    options.body,
    p_data:    options.data ?? null,
  });
  if (insertError) console.error("[notify] notify_insert failed:", insertError);

  // Demo org: keep the in-app notification (the bell works in the demo) but
  // never push to devices.
  if (!options.userId || isDemoOrgId(options.orgId)) return;

  await sendPushToUser(supabase, options.userId, {
    title: options.title,
    body:  options.body,
    data:  options.data,
    tag:   options.type,
  }, options.type);
}

// Helper: notify all managers of one organization.
// Inserts one broadcast notification (user_id = null) for the in-app feed,
// then sends a push to each manager's devices individually.
export async function notifyManagers(
  supabase: SupabaseClient,
  orgId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const { error: mgrInsertError } = await supabase.rpc("notify_insert", {
    p_org_id:  orgId,
    p_user_id: null,
    p_type:    type,
    p_title:   title,
    p_body:    body,
    p_data:    data ?? null,
  });
  if (mgrInsertError) console.error("[notify] notify_insert failed:", mgrInsertError);

  // Demo org: in-app broadcast only, no device push.
  if (isDemoOrgId(orgId)) return;

  const { data: managers, error: mgrIdsError } = await supabase.rpc("notify_get_manager_ids", { p_org_id: orgId });
  if (mgrIdsError) console.error("[notify] notify_get_manager_ids failed:", mgrIdsError);
  if (!managers?.length) return;

  const payload: PushPayload = { title, body, data, tag: type };

  await Promise.all(
    (managers as { user_id: string }[]).map((m) =>
      sendPushToUser(supabase, m.user_id, payload, type).catch(() => {})
    )
  );
}

// Send the push only when the user's preference for this type is enabled.
// The in-app banner is delivered via Supabase Realtime on the notifications
// table, so the push exists purely for the background OS notification —
// skipping (rather than sending a silent push) avoids violating the
// userVisibleOnly promise, which can get the subscription revoked
// (iOS Safari especially).
async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload,
  type: NotificationType
): Promise<void> {
  // Don't push for a type the user has turned off.
  const prefKey = TYPE_TO_PREF[type];
  if (prefKey) {
    const { data: prefs } = await supabase.rpc("notify_get_push_prefs", { p_user_id: userId });
    if (prefs?.[0]?.[prefKey] === false) return;
  }

  const { data: subs, error: subsError } = await supabase.rpc("notify_get_push_subs", {
    p_user_id: userId,
  });
  if (subsError) console.error("[notify] notify_get_push_subs failed:", subsError);
  if (!subs?.length) return;

  // Skip the OS push to any device that currently has the app in the
  // foreground: the in-app banner (Supabase Realtime on the notifications
  // table) already shows it there, so the push would be a duplicate. Other
  // devices still get it. This is the reliable suppression point for iOS PWAs,
  // where the service worker can't detect an open window at push time.
  // Presence is per-device, kept fresh by a heartbeat keyed on each device's
  // push endpoint (components/PresenceHeartbeat.tsx + /api/presence).
  const { data: activeRows } = await supabase.rpc("notify_get_active_endpoints", {
    p_user_id: userId,
  });
  const activeEndpoints = new Set(
    (activeRows as { endpoint: string }[] | null ?? []).map((r) => r.endpoint)
  );

  const targets = (subs as { endpoint: string; p256dh: string; auth_key: string }[])
    .filter((sub) => !activeEndpoints.has(sub.endpoint));
  if (!targets.length) return;

  const stale: string[] = [];
  await Promise.all(
    targets.map(async (sub) => {
      const result = await sendPush(sub, payload);
      if (result === "gone") stale.push(sub.endpoint);
    })
  );

  if (stale.length > 0) {
    const { error: deleteSubsError } = await supabase.rpc("notify_delete_subs", {
      p_user_id:   userId,
      p_endpoints: stale,
    });
    if (deleteSubsError) console.error("[notify] notify_delete_subs failed:", deleteSubsError);
  }
}

function chessCopyFromStatus(
  status: string,
  fromName: string
): { title: string; body: string } {
  if (status === "white_wins" || status === "black_wins")
    return { title: "Checkmate!", body: `${fromName} won the game` };
  if (status === "draw")
    return { title: "Draw!", body: "The game ended in a draw" };
  return { title: "Your move!", body: `${fromName} made their move` };
}

// Notify a player of a chess move. Inserts a *self-replacing* notification
// row (notify_upsert_chess deletes the previous chess_move row for the same
// conversation first), so the feed holds at most one chess entry per game
// showing its current state, and the Realtime banner pipeline covers users
// without a push subscription. Push then follows the standard pref-gated path.
export async function notifyChessMove(
  supabase: SupabaseClient,
  options: {
    orgId: string;
    toUserId: string;
    fromUserId: string;
    fromName: string;
    convId: string;
    chessStatus: string;
  }
): Promise<void> {
  const { title, body } = chessCopyFromStatus(options.chessStatus, options.fromName);
  const data = {
    type:       "chess_move",
    fromUserId: options.fromUserId,
    fromName:   options.fromName,
    convId:     options.convId,
  };

  const { error: upsertError } = await supabase.rpc("notify_upsert_chess", {
    p_org_id:  options.orgId,
    p_user_id: options.toUserId,
    p_title:   title,
    p_body:    body,
    p_data:    data,
  });
  if (upsertError) console.error("[notify] notify_upsert_chess failed:", upsertError);

  // Demo org: in-app only, never push to devices.
  if (isDemoOrgId(options.orgId)) return;

  await sendPushToUser(supabase, options.toUserId, {
    title,
    body,
    tag:  `chess:${options.convId}`,
    data,
  }, "chess_move");
}
