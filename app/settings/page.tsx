import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SettingsPageClient from "./settingsPageClient";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  const isDemo = params.demo === "true";

  let isManagerInitial = isDemo; // demo always shows manager view
  if (!isDemo) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: managerRow } = await supabase
      .from("managers")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    isManagerInitial = !!managerRow;
  }

  return (
    <Suspense>
      <SettingsPageClient isDemo={isDemo} isManagerInitial={isManagerInitial} />
    </Suspense>
  );
}
