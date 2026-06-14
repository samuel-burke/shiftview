// Server-side Cloudflare Turnstile verification for the demo entry point.
// POST /api/demo/start creates real (anonymous) auth users, so it's gated
// against bots. Enforcement is opt-in: with no TURNSTILE_SECRET_KEY set
// (local dev, e2e, preview without keys) verification passes.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string | null,
  ip?: string | null
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) {
      console.error("[turnstile] siteverify returned", res.status);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) {
      console.warn("[turnstile] verification failed:", data["error-codes"]);
    }
    return !!data.success;
  } catch (err) {
    console.error("[turnstile] siteverify request failed:", err);
    return false;
  }
}
