"use client";

import { useEffect } from "react";

// Tells the server when the app is in the foreground so it can suppress
// duplicate OS push notifications while the user is actively looking at the app
// (the in-app banner via Supabase Realtime already shows them). This is the
// reliable cross-platform mechanism: on iOS installed PWAs the service worker
// can't dependably detect an open window at push time, so the push has to be
// skipped server-side before it's sent. See app/api/presence/route.ts and
// lib/notify.ts.

// Re-assert presence comfortably inside the server's 60s window.
const HEARTBEAT_MS = 25_000;

function send(active: boolean, viaBeacon = false) {
  const payload = JSON.stringify({ active });

  // On hide/unload, sendBeacon is the most reliable way to get the request out.
  if (viaBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon("/api/presence", blob)) return;
    } catch {
      // fall through to fetch
    }
  }

  try {
    // keepalive lets a heartbeat survive the page being backgrounded/closed.
    void fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // presence is best-effort; ignore failures
  }
}

export default function PresenceHeartbeat() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function startBeating() {
      send(true);
      timer ??= setInterval(() => send(true), HEARTBEAT_MS);
    }
    function stopBeating() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        startBeating();
      } else {
        // Backgrounded — stop beating and expire presence so OS pushes resume.
        stopBeating();
        send(false, true);
      }
    }

    function onPageHide() {
      stopBeating();
      send(false, true);
    }

    if (document.visibilityState === "visible") startBeating();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      stopBeating();
    };
  }, []);

  return null;
}
