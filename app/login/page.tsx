"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import TryDemoButton from "@/components/TryDemoButton";
import Logo from "@/components/Logo";
import FormError from "@/components/FormError";
import { TURNSTILE_SITE_KEY, loadTurnstile, turnstileTheme } from "@/lib/turnstile-client";

type Step = "email" | "code";

function getSupabase() {
  return createClient();
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const siteKey = TURNSTILE_SITE_KEY;
    if (!siteKey || step !== "email") return;
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
          "error-callback": (errorCode) => {
            setCaptchaToken(null);
            setError(`Verification failed${errorCode ? ` (${errorCode})` : ""} — please reload and try again`);
          },
        });
      })
      .catch(() => setError("Could not load the verification widget"));
    return () => { cancelled = true; widgetIdRef.current = null; };
  }, [step]);

  async function handleSendCode() {
    if (!email.trim()) { setError("Email is required."); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setError("Please complete the verification first."); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        captchaToken: captchaToken ?? undefined,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    // Auth consumes the token even when the OTP request fails.
    setCaptchaToken(null);
    if (widgetIdRef.current) {
      try { window.turnstile?.reset(widgetIdRef.current); } catch {}
    }
    if (error) {
      setError(error.message);
    } else {
      setStep("code");
    }
    setLoading(false);
  }

  async function handleVerify() {
    if (!code.trim()) { setError("Enter the code from your email."); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="min-h-dvh bg-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[360px] mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg-secondary transition-colors py-3 -my-3"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Home
        </Link>
      </div>
      <div className="w-full max-w-[360px] bg-card rounded-2xl border border-line p-8">
        <div className="text-center mb-8">
          <Link href="/" aria-label="ShiftView home" className="inline-block">
            <Logo className="h-7" />
          </Link>
          <div className="text-xs text-fg-subtle mt-1.5" aria-live="polite">
            {step === "email" ? "Sign in to your account" : `Code sent to ${email}`}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {step === "email" ? (
            <>
              <label htmlFor="login-email" className="sr-only">Email address</label>
              <input
                id="login-email"
                type="email"
                placeholder="Email"
                aria-describedby={error ? "login-error" : undefined}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                autoFocus
                className="w-full bg-bg border border-field rounded-[10px] px-[14px] py-3 text-fg text-sm focus:outline-none focus:border-accent transition-colors"
              />
              <FormError id="login-error" message={error} className="text-center" />
              <div ref={widgetContainerRef} className="flex justify-center empty:hidden" />
              <button
                onClick={handleSendCode}
                disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                className={`w-full bg-gradient-to-r from-brand-from to-brand-to border border-transparent rounded-[10px] px-[14px] py-3 text-on-accent text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 disabled:opacity-70 ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Sending…" : "Send Code"}
              </button>
              <TryDemoButton className="w-full bg-transparent border border-line rounded-[10px] px-[14px] py-3 text-fg-subtle text-sm cursor-pointer hover:text-fg-secondary hover:border-line-strong transition-colors">
                View Demo
              </TryDemoButton>
              <p className="text-center text-xs text-fg-subtle mt-1">
                New to ShiftView?{" "}
                <Link href="/signup" className="text-accent-fg hover:text-accent-fg-strong transition-colors font-semibold py-2 -my-2 inline-block">
                  Create an organization
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="text-[13px] text-fg-subtle text-center mb-1">
                Enter the 6-digit code from your email
              </div>
              <label htmlFor="login-code" className="sr-only">6-digit verification code</label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-describedby={error ? "login-error" : undefined}
                value={code}
                maxLength={6}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
                className="w-full bg-bg border border-field rounded-[10px] px-[14px] py-3 text-fg text-2xl font-bold text-center tracking-[0.3em] focus:outline-none focus:border-accent transition-colors caret-transparent"
              />
              <FormError id="login-error" message={error} className="text-center" />
              <button
                onClick={handleVerify}
                disabled={loading}
                className={`w-full bg-gradient-to-r from-brand-from to-brand-to border border-transparent rounded-[10px] px-[14px] py-3 text-on-accent text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
              <button
                onClick={() => { setStep("email"); setCode(""); setError(null); }}
                className="w-full bg-transparent border border-line rounded-[10px] px-[14px] py-3 text-fg-subtle text-sm cursor-pointer hover:text-fg-secondary hover:border-line-strong transition-colors"
              >
                Back
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-fg-subtle mt-6">
          <Link href="/privacy" className="hover:text-fg-secondary transition-colors py-2 -my-2 inline-block">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
