import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import SettingsPageClient from "./settingsPageClient";

export default async function SettingsPage() {
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
