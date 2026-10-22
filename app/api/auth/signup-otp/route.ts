import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isProductionDeployment } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

function trustedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = new Set([new URL(request.url).origin]);
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try { allowed.add(new URL(site).origin); } catch {}
  }
  return allowed.has(origin) ? origin : null;
}

// Supabase Auth must have CAPTCHA protection enabled: checking only this
// route leaves direct public Auth requests unprotected. Forward the token
// without calling siteverify here, since Turnstile tokens are single-use.
export async function POST(request: Request) {
  const { email = null, turnstileToken = null } = await request.json().catch(() => ({}));
  const captchaToken = typeof turnstileToken === "string" ? turnstileToken : undefined;

  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if ((isProductionDeployment() && !process.env.TURNSTILE_SECRET_KEY) ||
      (process.env.TURNSTILE_SECRET_KEY && !captchaToken?.trim())) {
    return NextResponse.json(
      { error: "Verification failed — please try again" },
      { status: 403 }
    );
  }

  // Build the email link target from the request origin (the browser sets it
  // on same-origin POSTs); fall back to Supabase's configured Site URL. The
  // Origin header is caller-controlled, so it is only used when it names this
  // site: otherwise a script could send a real person a sign-up link that
  // lands on another host (Supabase's redirect allowlist is the backstop).
  const origin = trustedOrigin(request);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      captchaToken,
      // New-user verification emails may contain a link instead of a code
      // (depending on the Supabase email template); make sure it lands back
      // in this app, where the signed-in flow finishes the sign-up.
      ...(origin ? { emailRedirectTo: `${origin}/auth/callback` } : {}),
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "captcha_failed" ? 403 : 400 });
  }
  return NextResponse.json({ ok: true });
}
