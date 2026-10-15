// Server-side Cloudflare Turnstile verification for the bot-gated auth entry
// points: POST /api/demo/start (mints anonymous users) and POST
// /api/auth/signup-otp (mints users + emails them), plus the public contact
// form. With no TURNSTILE_SECRET_KEY set the gate is off (local dev, e2e,
// preview without keys), except in the production deployment, where a
// missing key fails closed: a dropped env var must not silently open the
// demo and sign-up to bots.

// Vercel sets VERCEL_ENV to "production" only for the production deployment
// (previews are "preview", even though NODE_ENV is "production" there too).
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string | null,
  ip?: string | null
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!isProductionDeployment()) return true;
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set in production; rejecting");
    return false;
  }
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
