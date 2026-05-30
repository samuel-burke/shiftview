import webpush from "web-push";

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT ?? "mailto:noreply@shiftview.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  tag?: string;
};

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

export async function sendPush(
  sub: PushSubscriptionRecord,
  payload: PushPayload
): Promise<"ok" | "gone"> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[webpush] VAPID keys not configured — skipping push");
    return "ok";
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icon-192.png",
        badge: payload.badge ?? "/icon-96.png",
        data: payload.data ?? {},
        tag: payload.tag,
      })
    );
    return "ok";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) return "gone";
    console.error("[webpush] send error:", err);
    return "ok";
  }
}
