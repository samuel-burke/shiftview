"use client";

import NotificationBell from "./NotificationBell";
import UserMenu from "./UserMenu";
import { useAppData } from "@/lib/AppDataContext";
import { createClient } from "@/lib/supabase-browser";
import { signOut } from "@/lib/sign-out";

/*
 * The bell and the user menu, for the right end of a page's own header row.
 * Team, Schedule and Clock place theirs in their headers (and TopBar); the
 * other app pages show this from the tablet size class up, where no TopBar
 * is drawn, so the two never disappear when you move between pages.
 */
export default function HeaderActions({ className = "" }: { className?: string }) {
  const { me } = useAppData();

  async function handleSignOut() {
    if (!await signOut(createClient())) return;
    window.location.href = "/login";
  }

  return (
    <div className={`items-center gap-2 shrink-0 ${className}`}>
      <NotificationBell />
      <UserMenu name={me.employeeName} onSignOut={handleSignOut} />
    </div>
  );
}
