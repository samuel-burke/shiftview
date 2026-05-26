"use client";

import { useState, useEffect } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function InviteSheet({ open, onClose, onSuccess }: Props) {
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setError(null);
      setSent(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to send invite"); return; }
      setSent(true);
      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 40,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
        }}
      />
      <div
        style={isDesktop ? {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: open ? "translate(-50%, -50%)" : "translate(-50%, -48%)",
          opacity: open ? 1 : 0,
          transition: "opacity 0.2s, transform 0.2s",
          pointerEvents: open ? "auto" : "none",
          zIndex: 50,
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 20,
          width: 420,
        } : {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "#0f172a",
          borderTop: "1px solid #1e293b",
          borderRadius: "24px 24px 0 0",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1)",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        {!isDesktop && (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#334155" }} />
          </div>
        )}

        <div style={{ padding: isDesktop ? "24px 28px 28px" : "8px 24px 44px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>
              Add Employee
            </div>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "#1e293b", border: "none",
                color: "#64748b", fontSize: 16, cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          {sent ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>
                Invite sent!
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>
                {name} will receive an email to set up their account.
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: "12px 32px", borderRadius: 12,
                  background: "#1e293b", border: "1px solid #334155",
                  color: "#94a3b8", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Full Name", val: name, set: setName, type: "text", placeholder: "Alice Smith" },
                { label: "Email",     val: email, set: setEmail, type: "email", placeholder: "alice@example.com" },
              ].map(({ label, val, set, type, placeholder }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                    {label}
                  </div>
                  <input
                    type={type}
                    value={val}
                    placeholder={placeholder}
                    onChange={(e) => { set(e.target.value); setError(null); }}
                    style={{
                      width: "100%",
                      background: "#1a2236",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "12px 14px",
                      color: "#f1f5f9",
                      fontSize: 16,
                      colorScheme: "dark",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}

              {error && (
                <div style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                style={{
                  padding: "14px 0", borderRadius: 12, marginTop: 4,
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  border: "none", color: "#fff",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Sending…" : "Send Invite"}
              </button>

              <button
                onClick={onClose}
                disabled={saving}
                style={{
                  padding: "14px 0", borderRadius: 12,
                  background: "transparent", border: "none",
                  color: "#475569", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
