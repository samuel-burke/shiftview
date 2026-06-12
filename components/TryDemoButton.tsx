"use client";

import { useRef, useState } from "react";
import { ME_CACHE_KEY } from "@/lib/AppDataContext";

// Cloudflare Turnstile bot gate for the demo entry point. Active only when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (TURNSTILE_SECRET_KEY enforces
// server-side in /api/demo/start); without it the button starts the demo
// directly, so local dev and e2e need no keys.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    "error-callback"?: () => void;
    "expired-callback"?: () => void;
    appearance?: "always" | "execute" | "interaction-only";
  }) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"));
    script.onerror = () => { scriptPromise = null; reject(new Error("turnstile script failed")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

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
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  async function startDemo(turnstileToken: string | null) {
    try {
      const res = await fetch("/api/demo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Demo is unavailable right now");
        setLoading(false);
        if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
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

  async function handleClick() {
    setLoading(true);
    setError(null);

    if (!TURNSTILE_SITE_KEY) {
      startDemo(null);
      return;
    }

    if (widgetIdRef.current) {
      // Retry: re-run the existing widget rather than rendering a second one.
      window.turnstile?.reset(widgetIdRef.current);
      return;
    }

    try {
      const turnstile = await loadTurnstile();
      widgetIdRef.current = turnstile.render(widgetContainerRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: "always",
        callback: (token) => startDemo(token),
        "error-callback": () => {
          setError("Verification failed — please try again");
          setLoading(false);
        },
        "expired-callback": () => setLoading(false),
      });
    } catch {
      setError("Could not load the verification widget");
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={handleClick} disabled={loading} className={className}>
        {loading ? "Starting demo…" : children}
      </button>
      <div ref={widgetContainerRef} className="flex justify-center empty:hidden" />
      {error && (
        <div role="alert" className="text-xs text-red-400 text-center">
          {error}
        </div>
      )}
    </>
  );
}
