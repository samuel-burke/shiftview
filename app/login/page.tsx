"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
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
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#f1f5f9",
              letterSpacing: "-0.02em",
            }}
          >
            Shift
            <span
              style={{
                background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              View
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
            Sign in to your account
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              background: "#0a1628",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: "12px 14px",
              color: "#f1f5f9",
              fontSize: 14,
              outline: "none",
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={{
              background: "#0a1628",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: "12px 14px",
              color: "#f1f5f9",
              fontSize: 14,
              outline: "none",
            }}
          />

          {error && (
            <div
              style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
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
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <button
            onClick={() => router.push("/?demo=true")}
            style={{
              background: "transparent",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: "12px 14px",
              color: "#64748b",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            View Demo
          </button>
        </div>
      </div>
    </main>
  );
}
