import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import AdminPageClient from "./adminPageClient";

const DEMO_USER_ID = "demo-manager";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  const isDemo = params.demo === "true";

  if (!isDemo) {
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

  return (
    <Suspense>
      <AdminPageClient currentUserId={DEMO_USER_ID} />
    </Suspense>
  );
}
