import { Suspense } from "react";
import { createClient } from "@/lib/supabase-server";
import PageClient from "./pageClient";
import LandingPage from "./landing";

// E2E runs intercept all /api/* calls client-side and have no Supabase, so
// the Playwright webServer sets E2E_BYPASS_AUTH=1 to skip the server-side
// auth gate (see playwright.config.ts). Never set in production.
const e2eBypass = process.env.E2E_BYPASS_AUTH === "1";

export default async function Page() {
  if (!e2eBypass) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return <LandingPage />;
    }
  }

  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
