import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("demo") === "true") {
    return NextResponse.json({ isManager: true, employeeId: null, employeeName: "Demo Manager" });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user)
    return NextResponse.json({ isManager: false, employeeId: null, employeeName: null });

  const [{ data: managerRow }, { data: emp }] = await Promise.all([
    supabase.from("managers").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("employees").select("id, name").eq("user_id", user.id).maybeSingle(),
  ]);

  return NextResponse.json({
    isManager: !!managerRow,
    employeeId: emp?.id ?? null,
    employeeName: emp?.name ?? null,
  });
}
