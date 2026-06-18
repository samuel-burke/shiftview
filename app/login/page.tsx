"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import TryDemoButton from "@/components/TryDemoButton";
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

  // Supabase Auth CAPTCHA protection (when enabled) requires a Turnstile
  // token on signInWithOtp. Tokens are single-use, so the widget is reset
  // after every send attempt.
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
          "error-callback": (errorCode) =>
            setError(`Verification failed${errorCode ? ` (${errorCode})` : ""} — please reload and try again`),
        });
      })
      .catch(() => setError("Could not load the verification widget"));
    // Leaving the email step unmounts the container; coming back renders a
    // fresh widget, so the previous widget id is simply forgotten.
    return () => { cancelled = true; widgetIdRef.current = null; };
  }, [step]);

  function resetCaptcha() {
    setCaptchaToken(null);
    if (widgetIdRef.current) {
      try { window.turnstile?.reset(widgetIdRef.current); } catch {}
    }
  }

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
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    // The token was consumed by this attempt either way.
    resetCaptcha();
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
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm focus:outline-none focus:border-indigo-500/70 transition-colors"
              />
              {error && <div id="login-error" role="alert" className="text-xs text-red-400 text-center">{error}</div>}
              <div ref={widgetContainerRef} className="flex justify-center empty:hidden" />
              <button
                onClick={handleSendCode}
                disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 disabled:opacity-70 ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Sending…" : "Send Code"}
              </button>
              <TryDemoButton className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer hover:text-slate-300 hover:border-slate-700 transition-colors">
                View Demo
              </TryDemoButton>
              <p className="text-center text-xs text-slate-500 mt-1">
                New to ShiftView?{" "}
                <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                  Create an organization
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="text-[13px] text-slate-500 text-center mb-1">
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
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-2xl font-bold text-center tracking-[0.3em] focus:outline-none focus:border-indigo-500/70 transition-colors caret-transparent"
              />
              {error && <div id="login-error" role="alert" className="text-xs text-red-400 text-center">{error}</div>}
              <button
                onClick={handleVerify}
                disabled={loading}
                className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity hover:brightness-110 ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
              <button
                onClick={() => { setStep("email"); setCode(""); setError(null); }}
                className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer hover:text-slate-300 hover:border-slate-700 transition-colors"
              >
                Back
              </button>
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
