import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SettingsPageClient from "./settingsPageClient";

// E2E runs have no Supabase; the Playwright webServer sets E2E_BYPASS_AUTH=1
// to skip the server-side gate, as app/page.tsx does. Never set in production.
const e2eBypass = process.env.E2E_BYPASS_AUTH === "1";

export default async function SettingsPage() {
  if (e2eBypass) {
    return (
      <Suspense>
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
    <Suspense>
      <SettingsPageClient isManagerInitial={isManagerInitial} />
    </Suspense>
  );
}
