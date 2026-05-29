import { createAdminClient } from "./supabase-admin";
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
  // Target user UUID (null = broadcast to all managers)
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

// Insert a notification into the DB and fire a push to all subscriptions for that user.
export async function notify(options: NotifyOptions): Promise<void> {
  const supabase = createAdminClient();

  // Insert into notifications table
  await supabase.from("notifications").insert({
    user_id: options.userId,
    type:    options.type,
    title:   options.title,
    body:    options.body,
    data:    options.data ?? null,
  });

  if (!options.userId) return; // Broadcast notifications don't push (only in-app)

  // Fetch push subscriptions for this user
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", options.userId);

  if (!subs?.length) return;

  const payload: PushPayload = {
    title: options.title,
    body:  options.body,
    data:  options.data,
    tag:   options.type,
  };

  // Send push to each subscription; remove expired/gone ones
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendPush(sub, payload);
      if (result === "gone") stale.push(sub.endpoint);
    })
  );

  if (stale.length > 0) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .in("endpoint", stale)
      .eq("user_id", options.userId);
  }
}

// Helper: notify all managers
export async function notifyManagers(
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const supabase = createAdminClient();

  // Insert one broadcast notification (user_id = null) for the in-app feed
  await supabase.from("notifications").insert({ user_id: null, type, title, body, data: data ?? null });

  // Also push individually to each manager's subscriptions
  const { data: managers } = await supabase.from("managers").select("user_id");
  if (!managers?.length) return;

  await Promise.all(
    managers.map((m) =>
      notify({ userId: m.user_id, type, title, body, data })
        .catch(() => {})
    )
  );
}
