"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// The in-app banner shows nothing until a notification arrives, but it brings
// framer-motion with it. Loading it after the page keeps that library out of
// the code every page downloads first, and loading it only with a session
// keeps it off signed-out pages (login, the landing page) entirely.
const InAppNotificationBanner = dynamic(() => import("./InAppNotificationBanner"), { ssr: false });

// The Supabase browser client keeps the session in an `sb-<project>-auth-token`
// cookie (split into .0, .1… when large).
const hasSessionCookie = () => /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie);
const noSubscription = () => () => {};

export default function DeferredNotificationBanner() {
  // Re-render, and so re-check the cookie, on navigation — e.g. right after
  // signing in, which navigates client-side.
  usePathname();
  const signedIn = useSyncExternalStore(noSubscription, hasSessionCookie, () => false);
  return signedIn ? <InAppNotificationBanner /> : null;
}
