import { Suspense } from "react";
import { redirect } from "next/navigation";
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

    // Signed in but not a member of any organization — typically a sign-up
    // that authenticated via the email verification link before the org was
    // created. Send them to finish onboarding instead of an empty dashboard.
    const [{ data: managerRow }, { data: employeeRow }] = await Promise.all([
      supabase.from("managers").select("org_id").eq("user_id", user.id).limit(1).maybeSingle(),
      supabase.from("employees").select("id").eq("user_id", user.id).limit(1).maybeSingle(),
    ]);
    if (!managerRow && !employeeRow) {
      redirect("/signup");
    }
  }

  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
