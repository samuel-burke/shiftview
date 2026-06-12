"use client";

import { useRef, useState } from "react";
import { ME_CACHE_KEY } from "@/lib/AppDataContext";
import { TURNSTILE_SITE_KEY, loadTurnstile, turnstileTheme } from "@/lib/turnstile-client";

// Starts a demo session (anonymous sign-in + demo-org membership via
// POST /api/demo/start) and lands on the dashboard with a real session.
// When Turnstile is configured, the token is collected here and verified
// by Supabase Auth's CAPTCHA protection during the anonymous sign-in.
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
        theme: turnstileTheme(),
        callback: (token) => startDemo(token),
        // Surface Cloudflare's code: 110200 means the current hostname isn't
        // on the widget's allowlist, 4xxxx are bad-sitekey families.
        "error-callback": (errorCode) => {
          setError(`Verification failed${errorCode ? ` (${errorCode})` : ""} — please try again`);
          setLoading(false);
        },
        "expired-callback": () => setLoading(false),
      });
    } catch {
      setError("Could not load the verification widget");
      setLoading(false);
    }
  }

  // The wrapper keeps the challenge widget stacked under the button instead
  // of becoming a sibling item in whatever flex row hosts this component
  // (e.g. the landing page CTA row).
  return (
    <div className="flex flex-col gap-2">
      <button onClick={handleClick} disabled={loading} className={className}>
        {loading ? "Starting demo…" : children}
      </button>
      <div ref={widgetContainerRef} className="flex justify-center empty:hidden" />
      {error && (
        <div role="alert" className="text-xs text-red-400 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
