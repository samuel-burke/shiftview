import { fmtMinutes } from "@/data/types";

// Shape the SwapRequestsDrawer consumes (flat, display-ready). `schedule_a` is
// the requester's shift, `schedule_b` is the target's.
export type Swap = {
  id: number;
  status: "pending" | "accepted" | "declined" | "approved" | "denied";
  requesterId: number | null;
  targetId: number | null;
  requesterName: string;
  targetName: string;
  date: string;
  scheduleAId: number | null;
  scheduleBId: number | null;
  scheduleATime: string;
  scheduleBTime: string;
};

// GET /api/swaps returns nested employee/schedule joins; Supabase types them as
// object-or-array depending on the relationship, so normalize defensively.
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export type RawSwap = {
  id: number;
  status?: Swap["status"];
  requester_id?: number;
  target_id?: number;
  schedule_a_id?: number;
  schedule_b_id?: number;
  requester?: { name: string } | { name: string }[] | null;
  target?: { name: string } | { name: string }[] | null;
  schedule_a?: { date: string; start_minutes: number; end_minutes: number } | { date: string; start_minutes: number; end_minutes: number }[] | null;
  schedule_b?: { date: string; start_minutes: number; end_minutes: number } | { date: string; start_minutes: number; end_minutes: number }[] | null;
};

type DateEmbed = { date: string } | { date: string }[] | null | undefined;

// The day a swap is for: the earlier of its two shifts' dates (they're normally
// the same day). Null when neither shift's date is known.
export function swapDate(raw: { schedule_a?: DateEmbed; schedule_b?: DateEmbed }): string | null {
  const dates = [firstOf(raw.schedule_a)?.date, firstOf(raw.schedule_b)?.date]
    .filter((d): d is string => typeof d === "string" && d !== "")
    .map((d) => d.slice(0, 10))
    .sort();
  return dates[0] ?? null;
}

export function mapSwap(raw: RawSwap): Swap {
  const requester = firstOf(raw.requester);
  const target = firstOf(raw.target);
  const a = firstOf(raw.schedule_a);
  const b = firstOf(raw.schedule_b);
  return {
    id: raw.id,
    status: raw.status ?? "pending",
    requesterId: raw.requester_id ?? null,
    targetId: raw.target_id ?? null,
    requesterName: requester?.name ?? "Unknown",
    targetName: target?.name ?? "Unknown",
    date: a?.date ?? "",
    scheduleAId: raw.schedule_a_id ?? null,
    scheduleBId: raw.schedule_b_id ?? null,
    scheduleATime: a ? `${fmtMinutes(a.start_minutes)} – ${fmtMinutes(a.end_minutes)}` : "",
    scheduleBTime: b ? `${fmtMinutes(b.start_minutes)} – ${fmtMinutes(b.end_minutes)}` : "",
  };
}
