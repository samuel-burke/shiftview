import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("demo") === "true") {
    return NextResponse.json({ isManager: true, employeeId: null, employeeName: "Demo Manager" });
  }

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  // Unauthenticated or no org membership — return a blank identity, not an error.
  if (error) {
    return NextResponse.json({ isManager: false, employeeId: null, employeeName: null });
  }

  // Fetch the employee name if the caller has a linked employee in this org.
  let employeeId: number | null = ctx.employeeId;
  let employeeName: string | null = null;

  if (employeeId != null) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", ctx.orgId)
      .eq("id", employeeId)
      .maybeSingle();
    employeeId = emp?.id ?? null;
    employeeName = emp?.name ?? null;
  }

  return NextResponse.json({
    isManager: ctx.isManager,
    employeeId,
    employeeName,
  });
}
