"use client";

import { useEffect, useRef } from "react";

// Tells the server which device currently has the app in the foreground so it
// can skip the duplicate OS push to *that* device (the in-app banner already
// shows it there). Presence is keyed by the device's push subscription
// endpoint, so having the app open on one device never suppresses pushes to
// your other devices. See app/api/presence/route.ts and lib/notify.ts.
//
// A device with no push subscription has nothing to suppress, so it never
// heartbeats.

// Re-assert presence comfortably inside the server's 60s window.
const HEARTBEAT_MS = 25_000;

function postPresence(endpoint: string, active: boolean, viaBeacon = false) {
  const payload = JSON.stringify({ endpoint, active });

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
    void fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      // keepalive only matters for the hide/unload beacon fallback. Using it on
      // every foreground heartbeat tripped reliability bugs in iOS Safari,
      // which could stop the heartbeat from landing at all.
      keepalive: viaBeacon,
    }).catch(() => {});
  } catch {
    // presence is best-effort; ignore failures
  }
}

export default function PresenceHeartbeat() {
  // This device's push subscription endpoint, resolved lazily and cached so the
  // hide/unload beacon can fire synchronously.
  const endpointRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function resolveEndpoint(): Promise<string | null> {
      if (endpointRef.current) return endpointRef.current;
      if (!("serviceWorker" in navigator)) return null;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        endpointRef.current = sub?.endpoint ?? null;
      } catch {
        endpointRef.current = null;
      }
      return endpointRef.current;
    }

    function beat(active: boolean, viaBeacon = false) {
      const endpoint = endpointRef.current;
      if (endpoint) postPresence(endpoint, active, viaBeacon);
    }

    async function startBeating() {
      const endpoint = await resolveEndpoint();
      // No push subscription on this device → nothing to suppress.
      if (cancelled || !endpoint) return;
      postPresence(endpoint, true);
      timer ??= setInterval(() => beat(true), HEARTBEAT_MS);
    }
    function stopBeating() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void startBeating();
      } else {
        // Backgrounded — stop beating and expire presence so OS pushes resume.
        stopBeating();
        beat(false, true);
      }
    }

    function onPageHide() {
      stopBeating();
      beat(false, true);
    }

    if (document.visibilityState === "visible") void startBeating();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      stopBeating();
    };
  }, []);

  return null;
}
