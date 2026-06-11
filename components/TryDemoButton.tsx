"use client";

import { useState } from "react";
import { ME_CACHE_KEY } from "@/lib/AppDataContext";

// Starts a demo session (anonymous sign-in + demo-org membership via
// POST /api/demo/start) and lands on the dashboard with a real session.
export default function TryDemoButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Demo is unavailable right now");
        setLoading(false);
        return;
      }
      // Drop any cached identity from a previous session, then do a full
      // navigation so the server sees the new auth cookies.
      try { localStorage.removeItem(ME_CACHE_KEY); } catch {}
      window.location.assign("/");
    } catch {
      setError("Demo is unavailable right now");
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={startDemo} disabled={loading} className={className}>
        {loading ? "Starting demo…" : children}
      </button>
      {error && (
        <div role="alert" className="text-xs text-red-400 text-center">
          {error}
        </div>
      )}
    </>
  );
}
