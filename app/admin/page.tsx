import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import AdminPageClient from "./adminPageClient";

// E2E runs have no Supabase; the Playwright webServer sets E2E_BYPASS_AUTH=1
// to skip the server-side gate, as app/page.tsx does. Never set in production.
const e2eBypass = process.env.E2E_BYPASS_AUTH === "1";

export default async function AdminPage() {
  if (e2eBypass) {
    return (
      <Suspense>
        <AdminPageClient currentUserId="e2e-user" />
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

  if (!managerRow) redirect("/");

  return (
    <Suspense>
      <AdminPageClient currentUserId={user.id} />
    </Suspense>
  );
}
