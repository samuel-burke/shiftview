import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPush, type PushPayload } from "./webpush";

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

  if (!options.userId) return;

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

async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload,
  type?: NotificationType
): Promise<void> {
  // Check the user's OS notification preference. We still send the push
  // regardless — when the app is in the foreground the SW delivers it as an
  // in-app banner (always shown). _osEnabled only gates the background/closed
  // OS notification inside the SW.
  let osEnabled = true;
  if (type) {
    const prefKey = TYPE_TO_PREF[type];
    if (prefKey) {
      const { data: prefs } = await supabase.rpc("notify_get_push_prefs", { p_user_id: userId });
      osEnabled = prefs?.[0]?.[prefKey] !== false;
    }
  }

  const { data: subs, error: subsError } = await supabase.rpc("notify_get_push_subs", {
    p_user_id: userId,
  });
  if (subsError) console.error("[notify] notify_get_push_subs failed:", subsError);
  if (!subs?.length) return;

  const payloadWithPref: PushPayload = {
    ...payload,
    data: { ...(payload.data ?? {}), _osEnabled: osEnabled },
  };

  const stale: string[] = [];
  await Promise.all(
    (subs as { endpoint: string; p256dh: string; auth_key: string }[]).map(
      async (sub) => {
        const result = await sendPush(sub, payloadWithPref);
        if (result === "gone") stale.push(sub.endpoint);
      }
    )
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

// Send a push for a chess move without inserting into the notifications table.
// Chess moves are ephemeral game events, not persistent notifications.
export async function notifyChessMove(
  supabase: SupabaseClient,
  options: {
    toUserId: string;
    fromUserId: string;
    fromName: string;
    convId: string;
    chessStatus: string;
  }
): Promise<void> {
  const { title, body } = chessCopyFromStatus(options.chessStatus, options.fromName);
  await sendPushToUser(supabase, options.toUserId, {
    title,
    body,
    tag: `chess:${options.convId}`,
    data: {
      type:       "chess_move",
      fromUserId: options.fromUserId,
      fromName:   options.fromName,
      convId:     options.convId,
    },
  }, "chess_move");
}
