import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || isNaN(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const { status } = await request.json();
  if (status !== "approved" && status !== "denied")
    return NextResponse.json(
      { error: 'status must be "approved" or "denied"' },
      { status: 400 }
    );

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // Fetch the request before updating so we can notify the employee
  const { data: pto } = await supabase
    .from("time_off_requests")
    .select("employee_id, date")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("time_off_requests")
    .update({ status })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify the employee of the decision
  if (pto?.employee_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("user_id")
      .eq("id", pto.employee_id)
      .maybeSingle();
    if (emp?.user_id) {
      notify({
        userId: emp.user_id,
        type: status === "approved" ? "pto_approved" : "pto_denied",
        title: status === "approved" ? "Time Off Approved" : "Time Off Denied",
        body: status === "approved"
          ? `Your time-off request for ${pto.date} has been approved.`
          : `Your time-off request for ${pto.date} was denied.`,
        data: { ptoId: id, date: pto.date },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
