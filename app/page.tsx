import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import PageClient from "./pageClient";
import LandingPage from "./landing";
import type { Metadata } from "next";

// The signed-out landing page shares this route with the dashboard, so the
// marketing description lives here rather than in the root layout.
export const metadata: Metadata = {
  title: "ShiftView · Scheduling and time clock for shift teams",
  description: "Build the week, see live coverage as people clock in, and approve requests from your phone. Scheduling, time clock and coverage for retail and fulfillment teams.",
  openGraph: {
    title: "ShiftView",
    description: "Scheduling, time clock and live coverage for retail and fulfillment teams.",
    type: "website",
  },
};

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
