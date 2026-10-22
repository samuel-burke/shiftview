import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isE2eBypassEnabled } from "@/lib/e2e-bypass";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import PrintWeekClient from "./printWeekClient";

const e2eBypass = isE2eBypassEnabled();

export const metadata = { title: "Print week · ShiftView" };

export default async function PrintWeekPage() {
  if (!e2eBypass) {
    const supabase = await createClient();
    const { error } = await requireManager(supabase);
    if (error) redirect("/");
  }
  return <Suspense fallback={null}><PrintWeekClient /></Suspense>;
}
