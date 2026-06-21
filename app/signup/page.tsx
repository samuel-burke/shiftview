"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { TURNSTILE_SITE_KEY, loadTurnstile, turnstileTheme } from "@/lib/turnstile-client";

type Step = "details" | "code";

function getSupabase() {
  return createClient();
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [orgName, setOrgName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once the OTP is verified; from then on retries only re-attempt the
  // organization creation instead of re-running the whole code exchange.
  const [verified, setVerified] = useState(false);

  // Users who are already signed in (clicked the verification link, or
  // belong to another organization) skip the OTP exchange entirely and go
  // straight to creating the organization.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user && !user.is_anonymous && user.email) setSessionEmail(user.email);
      })
      .catch(() => {});
  }, []);

  // Signup mints fresh auth users and emails them, so it's bot-gated. The
  // Turnstile token is verified server-side at /api/auth/signup-otp (which
  // also sends the OTP), mirroring the demo route's route-level check rather
  // than Supabase Auth's CAPTCHA — that lets login stay ungated. Tokens are
  // single-use, so the widget is reset after every send attempt.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const siteKey = TURNSTILE_SITE_KEY;
    // Signed-in users never send an OTP, so no challenge is needed.
    if (!siteKey || step !== "details" || sessionEmail) return;
    const container = widgetContainerRef.current;
    if (!container) return;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || container.childElementCount > 0) return;
        widgetIdRef.current = turnstile.render(container, {
          sitekey: siteKey,
          appearance: "always",
          theme: turnstileTheme(),
          size: "flexible",
          callback: (token) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(null),
          "error-callback": (errorCode) =>
            setError(`Verification failed${errorCode ? ` (${errorCode})` : ""} — please reload and try again`),
        });
      })
      .catch(() => setError("Could not load the verification widget"));
    // Leaving the details step unmounts the container; coming back renders a
    // fresh widget, so the previous widget id is simply forgotten.
    return () => { cancelled = true; widgetIdRef.current = null; };
  }, [step, sessionEmail]);

  function resetCaptcha() {
    setCaptchaToken(null);
    if (widgetIdRef.current) {
      try { window.turnstile?.reset(widgetIdRef.current); } catch {}
    }
  }

  async function handleSendCode() {
    if (!orgName.trim()) { setError("Organization name is required."); return; }
    if (!ownerName.trim()) { setError("Your name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setError("Please complete the verification first."); return; }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/signup-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), turnstileToken: captchaToken }),
    });
    // The token was consumed by this attempt either way.
    resetCaptcha();
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Could not send the code. Please try again.");
    } else {
      setStep("code");
    }
    setLoading(false);
  }

  async function createOrganization(): Promise<boolean> {
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: orgName.trim(), ownerName: ownerName.trim() }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Could not create the organization. Please try again.");
      return false;
    }
    return true;
  }

  // Already signed in — no OTP exchange, just provision the organization.
  async function handleCreateSignedIn() {
    if (!orgName.trim()) { setError("Organization name is required."); return; }
    if (!ownerName.trim()) { setError("Your name is required."); return; }
    setLoading(true);
    setError(null);
    if (await createOrganization()) {
      router.push("/");
      router.refresh();
    } else {
      setLoading(false);
    }
  }

  async function handleSwitchAccount() {
    await getSupabase().auth.signOut();
    setSessionEmail(null);
    setError(null);
  }

  async function handleVerify() {
    setLoading(true);
    setError(null);
    if (!verified) {
      if (!code.trim()) { setError("Enter the code from your email."); setLoading(false); return; }
      const supabase = getSupabase();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setVerified(true);
    }
    // Signed in — provision the organization with this user as owner.
    if (await createOrganization()) {
      router.push("/");
      router.refresh();
    } else {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-[360px] bg-card rounded-2xl border border-slate-800 p-8">
        <div className="text-center mb-8">
          <div className="text-2xl font-extrabold text-slate-100 tracking-tight">
            Shift
            <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
              View
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1.5" aria-live="polite">
            {step === "details" ? "Create your organization" : `Code sent to ${email}`}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {step === "details" ? (
            <>
              <label htmlFor="signup-org-name" className="sr-only">Organization name</label>
              <input
                id="signup-org-name"
                type="text"
                placeholder="Organization name"
                aria-describedby={error ? "signup-error" : undefined}
                value={orgName}
                maxLength={80}
                onChange={(e) => { setOrgName(e.target.value); setError(null); }}
                autoFocus
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm focus:outline-none focus:border-indigo-500/70 transition-colors"
              />
              <label htmlFor="signup-owner-name" className="sr-only">Your name</label>
              <input
                id="signup-owner-name"
                type="text"
                placeholder="Your name"
                aria-describedby={error ? "signup-error" : undefined}
                value={ownerName}
                maxLength={80}
                onChange={(e) => { setOwnerName(e.target.value); setError(null); }}
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm focus:outline-none focus:border-indigo-500/70 transition-colors"
              />
              {sessionEmail ? (
                <>
                  <div className="text-xs text-slate-500 text-center">
                    Signed in as <span className="text-slate-300 font-semibold">{sessionEmail}</span>
                  </div>
                  {error && <div id="signup-error" role="alert" className="text-xs text-red-400 text-center">{error}</div>}
                  <button
                    onClick={handleCreateSignedIn}
                    disabled={loading}
                    className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 disabled:opacity-70 ${loading ? "opacity-70" : "opacity-100"}`}
                  >
                    {loading ? "Creating…" : "Create Organization"}
                  </button>
                  <button
                    onClick={handleSwitchAccount}
                    className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer hover:text-slate-300 hover:border-slate-700 transition-colors"
                  >
                    Use a different account
                  </button>
                </>
              ) : (
                <>
                  <label htmlFor="signup-email" className="sr-only">Email address</label>
                  <input
                    id="signup-email"
                    type="email"
                    placeholder="Email"
                    aria-describedby={error ? "signup-error" : undefined}
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                    className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm focus:outline-none focus:border-indigo-500/70 transition-colors"
                  />
                  {error && <div id="signup-error" role="alert" className="text-xs text-red-400 text-center">{error}</div>}
                  <div ref={widgetContainerRef} className="flex justify-center empty:hidden" />
                  <button
                    onClick={handleSendCode}
                    disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                    className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 disabled:opacity-70 ${loading ? "opacity-70" : "opacity-100"}`}
                  >
                    {loading ? "Sending…" : "Send Code"}
                  </button>
                  <Link
                    href="/login"
                    className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm text-center cursor-pointer hover:text-slate-300 hover:border-slate-700 transition-colors"
                  >
                    Already have an account? Sign in
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] text-slate-500 text-center mb-1">
                Enter the 6-digit code from your email
              </div>
              <label htmlFor="signup-code" className="sr-only">6-digit verification code</label>
              <input
                id="signup-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-describedby={error ? "signup-error" : undefined}
                value={code}
                maxLength={6}
                disabled={verified}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-2xl font-bold text-center tracking-[0.3em] focus:outline-none focus:border-indigo-500/70 transition-colors caret-transparent disabled:opacity-50"
              />
              {error && <div id="signup-error" role="alert" className="text-xs text-red-400 text-center">{error}</div>}
              <button
                onClick={handleVerify}
                disabled={loading}
                className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? (verified ? "Creating…" : "Verifying…") : verified ? "Retry" : "Verify & Create"}
              </button>
              {!verified && (
                <button
                  onClick={() => { setStep("details"); setCode(""); setError(null); }}
                  className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer hover:text-slate-300 hover:border-slate-700 transition-colors"
                >
                  Back
                </button>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          <Link href="/privacy" className="hover:text-slate-300 transition-colors py-2 -my-2 inline-block">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
