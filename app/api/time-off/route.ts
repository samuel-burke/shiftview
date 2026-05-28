import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Check if manager (non-throwing pattern)
  const { error: managerError } = await requireManager(supabase);
  const isManager = !managerError;

  if (isManager) {
    // Fetch all pending requests
    const { data: requests, error } = await supabase
      .from("time_off_requests")
      .select("id, employee_id, date, status, note")
      .eq("status", "pending")
      .order("date", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Fetch employee names separately
    const employeeIds = [...new Set((requests ?? []).map((r) => r.employee_id))];
    let employeeMap: Record<number, string> = {};
    if (employeeIds.length > 0) {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, name")
        .in("id", employeeIds);
      for (const emp of employees ?? []) {
        employeeMap[emp.id] = emp.name;
      }
    }

    const result = (requests ?? []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: employeeMap[r.employee_id] ?? "Unknown",
      date: r.date,
      status: r.status,
      note: r.note ?? undefined,
    }));

    return NextResponse.json({ requests: result });
  }

  // Employee: fetch own requests for next 90 days
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp) return NextResponse.json({ requests: [] });

  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select("id, employee_id, date, status, note")
    .eq("employee_id", emp.id)
    .gte("date", today)
    .lte("date", ninetyDaysOut)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (requests ?? []).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: emp.name,
    date: r.date,
    status: r.status,
    note: r.note ?? undefined,
  }));

  return NextResponse.json({ requests: result });
}

export async function POST(request: Request) {
  const { employeeId, date, note } = await request.json();

  if (!employeeId || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  if (date < today)
    return NextResponse.json({ error: "date must be today or in the future" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Verify the employee belongs to the current user
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp)
    return NextResponse.json(
      { error: "Employee not found or not linked to your account" },
      { status: 403 }
    );

  const insertData: Record<string, unknown> = { employee_id: employeeId, date };
  if (note && typeof note === "string" && note.trim()) insertData.note = note.trim();

  const { data, error } = await supabase
    .from("time_off_requests")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}
