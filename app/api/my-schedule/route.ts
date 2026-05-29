import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEMO_EMPLOYEE_ID = 1;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  if (searchParams.get("demo") === "true") {
    return NextResponse.json({
      employeeId: null,
      employeeName: "Demo Manager",
      schedules: generateDemoSchedules(from!, to!),
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { data, error } = await supabase
      .from("schedules_demo")
      .select("*")
      .eq("employee_id", DEMO_EMPLOYEE_ID)
      .gte("date", from)
      .lte("date", to)
      .order("date");

    if (error) {
    console.error("[api/my-schedule]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

    return NextResponse.json({
      employeeId: DEMO_EMPLOYEE_ID,
      employeeName: null,
      schedules: mapSchedules(data ?? []),
    });
  }

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp) {
    return NextResponse.json({ employeeId: null, employeeName: null, schedules: [] });
  }

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("employee_id", emp.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (error) {
    console.error("[api/my-schedule]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    employeeId: emp.id,
    employeeName: emp.name,
    schedules: mapSchedules(data ?? []),
  });
}

function mapSchedules(data: any[]) {
  return data.map((s) => ({
    id: s.id,
    employeeId: s.employee_id,
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
  }));
}

// Shift pattern by day-of-week (0=Sun): [startMinutes, endMinutes] or null for day off
const DEMO_SHIFT_PATTERN: Record<number, [number, number] | null> = {
  0: null,
  1: [480, 960],   // Mon 8am–4pm
  2: [540, 1020],  // Tue 9am–5pm
  3: null,
  4: [600, 1080],  // Thu 10am–6pm
  5: [480, 1020],  // Fri 8am–5pm
  6: [540, 900],   // Sat 9am–3pm
};

function generateDemoSchedules(from: string, to: string) {
  const results = [];
  let id = 1000;
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end) {
    const dow = cur.getUTCDay();
    const shift = DEMO_SHIFT_PATTERN[dow];
    if (shift) {
      const date = cur.toISOString().slice(0, 10);
      results.push({ id: id++, employeeId: null, date, startMinutes: shift[0], endMinutes: shift[1] });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return results;
}
