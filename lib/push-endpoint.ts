// Only browser push services may receive server-side push requests.
// Apple and Windows use regional hosts under their push service domains.
export function parsePushEndpoint(endpoint: unknown): URL | null {
  if (typeof endpoint !== "string") return null;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash)
      return null;

    const host = url.hostname;
    if (
      host === "fcm.googleapis.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".push.apple.com") ||
      host.endsWith(".notify.windows.com")
    ) return url;
  } catch {
    // Invalid URLs are never usable push endpoints.
  }
  return null;
}
