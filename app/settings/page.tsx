import { createClient } from "@/lib/supabase-server";
import { isE2eBypassEnabled } from "@/lib/e2e-bypass";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SettingsPageClient from "./settingsPageClient";
import PageShellFallback from "@/components/PageShellFallback";

// E2E runs have no Supabase; the Playwright webServer sets E2E_BYPASS_AUTH=1
// to skip the server-side gate, as app/page.tsx does. Never set in production.
const e2eBypass = isE2eBypassEnabled();

export default async function SettingsPage() {
  if (e2eBypass) {
    return (
      <Suspense fallback={<PageShellFallback active="settings" isManager bottomNav={false} />}>
        <SettingsPageClient isManagerInitial />
      </Suspense>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const isManagerInitial = !!managerRow;

  return (
    <Suspense fallback={<PageShellFallback active="settings" isManager={isManagerInitial} bottomNav={false} />}>
      <SettingsPageClient isManagerInitial={isManagerInitial} />
    </Suspense>
  );
}
