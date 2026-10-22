"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import { reconcilePushSubscription } from "@/lib/push-subscription";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const supabase = createClient();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      // Supabase auth callbacks run under its session lock. Defer database
      // work until the callback returns to avoid deadlocking the auth client.
      const timer = setTimeout(() => {
        timers.delete(timer);
        void reconcilePushSubscription(supabase, session?.user.id ?? null)
          .catch((error) => console.warn("[push] Could not reconcile subscription", error));
      }, 0);
      timers.add(timer);
    });
    return () => {
      subscription.unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registering fetches and installs sw.js — work the first screen doesn't
    // need — so wait until the page has finished loading.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] registration failed:", err);
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
