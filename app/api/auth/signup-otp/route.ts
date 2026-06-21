import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { verifyTurnstileToken } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

// Sends the signup OTP from the server so the Turnstile bot gate is enforced
// before any verification email goes out. Signup is gated (it mints fresh
// auth users and emails arbitrary addresses); login is not (existing users
// only). Verification is route-level via TURNSTILE_SECRET_KEY — the same
// scheme the demo route uses — so Supabase Auth's CAPTCHA protection can stay
// off across every auth endpoint. With no secret key set the gate is off
// (local dev, e2e, preview without keys).
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { email = null, turnstileToken = null } = await request.json().catch(() => ({}));

  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    if (!(await verifyTurnstileToken(turnstileToken, ip === "unknown" ? null : ip))) {
      return NextResponse.json(
        { error: "Verification failed — please try again" },
        { status: 403 }
      );
    }
  }

  // Build the email link target from the request origin (the browser sets it
  // on same-origin POSTs); fall back to Supabase's configured Site URL.
  const origin = request.headers.get("origin");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      // New-user verification emails may contain a link instead of a code
      // (depending on the Supabase email template); make sure it lands back
      // in this app, where the signed-in flow finishes the sign-up.
      ...(origin ? { emailRedirectTo: `${origin}/auth/callback` } : {}),
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
