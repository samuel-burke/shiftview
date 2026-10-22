"use client";

import AppShell, { type NavItem } from "./AppShell";
import BottomNav from "./BottomNav";
import { useAppData } from "@/lib/AppDataContext";
import { createClient } from "@/lib/supabase-browser";
import { signOut } from "@/lib/sign-out";

type Props = {
  active: NavItem;
  /** Pages only managers reach pass true; others go by the signed-in user. */
  isManager?: boolean;
  /** The phone header, for the pages that show one (Team, Schedule, Clock). */
  topBar?: boolean;
  /** Settings has no bottom tabs. */
  bottomNav?: boolean;
};

/*
 * Suspense fallback for an app page: its nav and header around an empty page.
 * A page's code loads inside its Suspense boundary on a first visit, and with
 * no fallback the whole screen went blank meanwhile. This keeps the chrome
 * where it was; matching the page's own AppShell props means nothing moves
 * when the page replaces it.
 */
export default function PageShellFallback({ active, isManager, topBar = false, bottomNav = true }: Props) {
  const { me } = useAppData();

  async function handleSignOut() {
    if (!await signOut(createClient())) return;
    window.location.href = "/login";
  }

  return (
    <AppShell
      active={active}
      isManager={isManager ?? me.isManager}
      userName={topBar ? me.employeeName : undefined}
      onSignOut={topBar ? handleSignOut : undefined}
    >
      {bottomNav && <BottomNav active={active} />}
    </AppShell>
  );
}
