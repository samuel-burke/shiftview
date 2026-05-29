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
  | "schedule_published";

export type NotifyOptions = {
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
  await supabase.rpc("notify_insert", {
    p_user_id: options.userId,
    p_type:    options.type,
    p_title:   options.title,
    p_body:    options.body,
    p_data:    options.data ?? null,
  });

  if (!options.userId) return;

  await sendPushToUser(supabase, options.userId, {
    title: options.title,
    body:  options.body,
    data:  options.data,
    tag:   options.type,
  });
}

// Helper: notify all managers.
// Inserts one broadcast notification (user_id = null) for the in-app feed,
// then sends a push to each manager's devices individually.
export async function notifyManagers(
  supabase: SupabaseClient,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  await supabase.rpc("notify_insert", {
    p_user_id: null,
    p_type:    type,
    p_title:   title,
    p_body:    body,
    p_data:    data ?? null,
  });

  const { data: managers } = await supabase.rpc("notify_get_manager_ids");
  if (!managers?.length) return;

  const payload: PushPayload = { title, body, data, tag: type };

  await Promise.all(
    (managers as { user_id: string }[]).map((m) =>
      sendPushToUser(supabase, m.user_id, payload).catch(() => {})
    )
  );
}

async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload
): Promise<void> {
  const { data: subs } = await supabase.rpc("notify_get_push_subs", {
    p_user_id: userId,
  });
  if (!subs?.length) return;

  const stale: string[] = [];
  await Promise.all(
    (subs as { endpoint: string; p256dh: string; auth_key: string }[]).map(
      async (sub) => {
        const result = await sendPush(sub, payload);
        if (result === "gone") stale.push(sub.endpoint);
      }
    )
  );

  if (stale.length > 0) {
    await supabase.rpc("notify_delete_subs", {
      p_user_id:   userId,
      p_endpoints: stale,
    });
  }
}
