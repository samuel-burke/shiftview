// Shared timezone utilities for punch-related API routes.

export function getLocalMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m;
}

// Returns the UTC start and end instants that bound a full calendar day in `tz`.
// Using noon UTC as the reference avoids DST-at-midnight edge cases.
export function localDayBoundsUtc(dateKey: string, tz: string): { start: Date; end: Date } {
  const noonUtc = new Date(`${dateKey}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(noonUtc);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const localNoonMs = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second"),
  );
  const offsetMs = localNoonMs - noonUtc.getTime();
  const [y, mo, d] = dateKey.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, mo - 1, d,  0,  0,  0,   0) - offsetMs),
    end:   new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - offsetMs),
  };
}

export function todayKeyInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}
