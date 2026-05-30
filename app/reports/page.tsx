import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import ReportsPageClient from "./reportsPageClient";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { error } = await requireManager(supabase);
  if (error) redirect("/");
  return <Suspense fallback={null}><ReportsPageClient /></Suspense>;
}
