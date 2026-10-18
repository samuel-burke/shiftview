"use client";

import { useEffect } from "react";
import { cleanRef, notableReferrerHost } from "@/lib/notable-visit";

// Pings POST /api/visit once per browser session when the visitor arrived via
// a tagged link (?ref=resume) or from a hiring/developer site, so the
// operator gets an ntfy alert. See app/api/visit/route.ts.
const SESSION_KEY = "sv_visit_pinged";

export default function NotableVisitBeacon() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      return;
    }

    const ref = cleanRef(new URLSearchParams(window.location.search).get("ref"));
    let referrer: string | null = null;
    try {
      referrer = document.referrer ? notableReferrerHost(new URL(document.referrer).hostname) : null;
    } catch {
      // unparsable referrer
    }
    if (!ref && !referrer) return;

    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // ignore
    }
    fetch("/api/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, referrer, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
