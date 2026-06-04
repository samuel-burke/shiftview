import { Suspense } from "react";
import { createClient } from "@/lib/supabase-server";
import PageClient from "./pageClient";
import LandingPage from "./landing";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  const isDemo = params.demo === "true";

  if (!isDemo) {
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
