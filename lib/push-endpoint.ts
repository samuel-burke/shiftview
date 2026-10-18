// Web Push subscriptions name the URL the server POSTs each notification to.
// The browser's push service picks it, but the value reaches us from the
// client (POST /api/push/subscribe, or a direct insert into
// push_subscriptions, which RLS lets a user do for their own rows), so a
// signed-in user could otherwise point it anywhere and have the server send
// requests to internal or third-party hosts on their behalf (SSRF).
//
// Only the push services real browsers use are accepted: Chrome and other
// Chromium browsers (FCM), Firefox (Mozilla autopush), Safari (Apple) and
// Edge (Windows Push Notification Services).
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

const MAX_ENDPOINT_LENGTH = 2048;

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
