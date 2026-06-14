import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import AdminPageClient from "./adminPageClient";

export default async function AdminPage() {
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
