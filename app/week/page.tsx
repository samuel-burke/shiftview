import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import WeekPageClient from "./weekPageClient";

// E2E runs have no Supabase; the Playwright webServer sets E2E_BYPASS_AUTH=1
// to skip the server-side gate, as app/page.tsx does. Never set in production.
const e2eBypass = process.env.E2E_BYPASS_AUTH === "1";

export default async function WeekPage() {
  if (!e2eBypass) {
    const supabase = await createClient();
    const { error } = await requireManager(supabase);
    if (error) redirect("/");
  }

  return <Suspense fallback={null}><WeekPageClient /></Suspense>;
}
