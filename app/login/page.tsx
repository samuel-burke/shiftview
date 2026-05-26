"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

type Step = "email" | "code";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    if (!email.trim()) { setError("Email is required."); return; }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
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
          <div className="text-xs text-slate-600 mt-1.5">
            {step === "email" ? "Sign in to your account" : `Code sent to ${email}`}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {step === "email" ? (
            <>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                autoFocus
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm outline-none [color-scheme:dark]"
              />
              {error && <div className="text-xs text-red-400 text-center">{error}</div>}
              <button
                onClick={handleSendCode}
                disabled={loading}
                className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Sending…" : "Send Code"}
              </button>
              <button
                onClick={() => router.push("/?demo=true")}
                className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer"
              >
                View Demo
              </button>
            </>
          ) : (
            <>
              <div className="text-[13px] text-slate-500 text-center mb-1">
                Enter the 6-digit code from your email
              </div>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                maxLength={6}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                autoFocus
                className="w-full bg-bg border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-100 text-2xl font-bold text-center tracking-[0.3em] outline-none [color-scheme:dark]"
              />
              {error && <div className="text-xs text-red-400 text-center">{error}</div>}
              <button
                onClick={handleVerify}
                disabled={loading}
                className={`w-full bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-[10px] px-[14px] py-3 text-white text-sm font-bold cursor-pointer mt-1 transition-opacity ${loading ? "opacity-70" : "opacity-100"}`}
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
              <button
                onClick={() => { setStep("email"); setCode(""); setError(null); }}
                className="w-full bg-transparent border border-slate-800 rounded-[10px] px-[14px] py-3 text-slate-500 text-sm cursor-pointer"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
