"use client";

import { useEffect } from "react";

// While the app is on screen, ping the service worker so it can suppress OS
// push notifications (the in-app banner covers them instead). The moment the
// app is hidden we tell the SW immediately, so a push that arrives right after
// the user leaves still surfaces as an OS notification.
const HEARTBEAT_MS = 15000;

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err);
    });

    let timer: ReturnType<typeof setInterval> | null = null;

    function post(type: "APP_FOREGROUND" | "APP_BACKGROUND") {
      navigator.serviceWorker.controller?.postMessage({ type });
    }

    function stopHeartbeat() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function sync() {
      if (document.visibilityState === "visible") {
        post("APP_FOREGROUND");
        if (!timer) timer = setInterval(() => post("APP_FOREGROUND"), HEARTBEAT_MS);
      } else {
        stopHeartbeat();
        post("APP_BACKGROUND");
      }
    }

    // A freshly registered SW has no controller yet; send the first beat once
    // it takes control so the foreground state is known from the start.
    navigator.serviceWorker.ready.then(sync).catch(() => {});
    sync();

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", stopHeartbeat);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", stopHeartbeat);
      stopHeartbeat();
    };
  }, []);

  return null;
}
