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
    <main
      style={{
        minHeight: "100vh",
        background: "#0a1628",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#1a2236",
          borderRadius: 16,
          border: "1px solid #1e293b",
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
            Shift
            <span style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              View
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
            {step === "email" ? "Sign in to your account" : `Code sent to ${email}`}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {step === "email" ? (
            <>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                autoFocus
                style={inputStyle}
              />

              {error && <div style={errorStyle}>{error}</div>}

              <button onClick={handleSendCode} disabled={loading} style={primaryBtnStyle(loading)}>
                {loading ? "Sending…" : "Send Code"}
              </button>

              <button onClick={() => router.push("/?demo=true")} style={secondaryBtnStyle}>
                View Demo
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 4 }}>
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
                style={{ ...inputStyle, textAlign: "center", fontSize: 24, letterSpacing: "0.3em" }}
              />

              {error && <div style={errorStyle}>{error}</div>}

              <button onClick={handleVerify} disabled={loading} style={primaryBtnStyle(loading)}>
                {loading ? "Verifying…" : "Verify"}
              </button>

              <button
                onClick={() => { setStep("email"); setCode(""); setError(null); }}
                style={secondaryBtnStyle}
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

const inputStyle: React.CSSProperties = {
  background: "#0a1628",
  border: "1px solid #1e293b",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#f1f5f9",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#f87171",
  textAlign: "center",
};

const primaryBtnStyle = (loading: boolean): React.CSSProperties => ({
  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
  border: "none",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  opacity: loading ? 0.7 : 1,
  marginTop: 4,
});

const secondaryBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #1e293b",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#64748b",
  fontSize: 14,
  cursor: "pointer",
};
