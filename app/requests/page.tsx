import { Suspense } from "react";
import { isE2eBypassEnabled } from "@/lib/e2e-bypass";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import RequestsPageClient from "./requestsPageClient";
import PageShellFallback from "@/components/PageShellFallback";

// E2E runs have no Supabase; the Playwright webServer sets E2E_BYPASS_AUTH=1
// to skip the server-side gate, as app/page.tsx does. Never set in production.
const e2eBypass = isE2eBypassEnabled();

export default async function RequestsPage() {
  if (!e2eBypass) {
    const supabase = await createClient();
    const { error } = await requireManager(supabase);
    if (error) redirect("/");
  }

  return <Suspense fallback={<PageShellFallback active="requests" isManager />}><RequestsPageClient /></Suspense>;
}
