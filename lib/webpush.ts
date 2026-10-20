import webpush from "web-push";
import { lookup } from "node:dns";
import { Agent } from "node:https";
import { BlockList, isIP } from "node:net";
import { parsePushEndpoint } from "./push-endpoint";

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");

// IPv6 must be global unicast, excluding special-purpose/documentation ranges.
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
blockedAddresses.addSubnet("2001::", 23, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
blockedAddresses.addSubnet("2002::", 16, "ipv6");
blockedAddresses.addSubnet("3fff::", 20, "ipv6");

const pushAgent = new Agent({
  // Validate the addresses actually used by the socket; never preflight DNS
  // and then let the HTTP client resolve the hostname a second time.
  lookup(hostname, options, callback) {
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      if (!addresses.length || addresses.some(({ address, family }) =>
        isIP(address) !== family ||
        (family === 6 && !globalIPv6.check(address, "ipv6")) ||
        blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4")
      )) return callback(new Error("Push service resolved to a prohibited address"), []);

      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  },
});

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
  const endpoint = parsePushEndpoint(sub.endpoint);
  // Stored rows may predate validation or have been written directly via RLS.
  // Treat prohibited destinations like expired subscriptions so they are pruned.
  if (!endpoint) return "gone";

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[webpush] VAPID keys not configured — skipping push");
    return "ok";
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: endpoint.href,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icon-192.png",
        badge: payload.badge ?? "/icon-96.png",
        data: payload.data ?? {},
        tag: payload.tag,
      }),
      // web-push uses this agent with https.request and does not follow redirects.
      { agent: pushAgent }
    );
    return "ok";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) return "gone";
    console.error("[webpush] send error:", err);
    return "ok";
  }
}
