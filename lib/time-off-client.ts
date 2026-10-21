// Deciding a time-off request from the browser. Approving time off that
// clashes with the person's live shifts comes back as a TimeOffClashError
// listing them; the caller asks the manager, then decides again with
// resolve "remove" (take the shifts off the schedule) or "keep".

export type ClashingShift = { id: number; date: string; startMinutes: number; endMinutes: number };

export class TimeOffClashError extends Error {
  readonly shifts: ClashingShift[];
  constructor(message: string, shifts: ClashingShift[]) {
    super(message);
    this.name = "TimeOffClashError";
    this.shifts = shifts;
  }
}

export async function decideTimeOffRequest(
  id: number,
  status: "approved" | "denied",
  resolve?: "remove" | "keep",
  fetcher: typeof fetch = fetch
): Promise<{ removedShifts: number[] }> {
  const res = await fetcher(`/api/time-off/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resolve ? { status, resolve } : { status }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) ?? {};
  if (res?.status === 409 && body.conflict === "scheduled") {
    throw new TimeOffClashError(body.message ?? "They're scheduled during this time off.", Array.isArray(body.shifts) ? body.shifts : []);
  }
  if (!res?.ok) {
    throw new Error(body.error ?? `Couldn't ${status === "approved" ? "approve" : "deny"} the time off request.`);
  }
  return { removedShifts: Array.isArray(body.removedShifts) ? body.removedShifts : [] };
}
