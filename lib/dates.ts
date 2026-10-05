// Single source of truth for calendar-date and timezone math.
//
// The domain has two kinds of time:
//   • Calendar dates (YYYY-MM-DD "date keys") and wall-clock minutes since
//     midnight — schedules, time off, call-outs, store hours. These have no
//     timezone of their own; they mean "in the store's timezone".
//   • Instants (ISO timestamptz) — punches, messages, notifications.
//
// Everything that turns "now" or an instant into a calendar date, or a store
// wall-clock time into an instant, must go through the store's IANA timezone
// (app_settings.timezone) — never the server's clock zone (UTC on Vercel) nor
// the viewer's browser zone, which can be anywhere.
//
// Pure date-key arithmetic is done on a noon-UTC anchor so it is independent
// of any runtime timezone and immune to DST transitions.

export const DEFAULT_TIMEZONE = "America/New_York";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// An IANA zone name ("America/New_York", "Etc/GMT+5", "UTC") that this
// runtime recognises. Bare offsets like "+05:30" are rejected even where the
// engine accepts them: older browsers throw on them, and they never observe DST.
const IANA_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !IANA_NAME_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Falls back to the default for missing or unrecognised zones so a bad
// settings row can never crash a request with a RangeError.
export function resolveTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ── Date-key arithmetic (timezone-free) ─────────────────────────────────────

function keyToNoonUtc(key: string): Date {
  return new Date(`${key.slice(0, 10)}T12:00:00Z`);
}

export function addDaysToKey(key: string, days: number): string {
  const d = keyToNoonUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday … 6 = Saturday.
export function dayOfWeekForKey(key: string): number {
  return keyToNoonUtc(key).getUTCDay();
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetweenKeys(from: string, to: string): number {
  return Math.round((keyToNoonUtc(to).getTime() - keyToNoonUtc(from).getTime()) / 86_400_000);
}

// The first day of the week (by `firstDayOfWeek`, 0 = Sunday) containing `key`.
export function weekStartForKey(key: string, firstDayOfWeek: number): string {
  const diff = (dayOfWeekForKey(key) - firstDayOfWeek + 7) % 7;
  return addDaysToKey(key, -diff);
}

// The Monday–Sunday week before the one containing `todayKey` — the default
// payroll period.
export function previousPayWeek(todayKey: string): { from: string; to: string } {
  const thisMonday = weekStartForKey(todayKey, 1);
  return { from: addDaysToKey(thisMonday, -7), to: addDaysToKey(thisMonday, -1) };
}

// Inclusive list of date keys from `from` to `to`.
export function eachDateKey(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from.slice(0, 10); k <= to.slice(0, 10); k = addDaysToKey(k, 1)) out.push(k);
  return out;
}

// Format a date key for display without letting any runtime zone shift it.
export function formatDateKey(key: string, opts: Intl.DateTimeFormatOptions, locale = "en-US"): string {
  return keyToNoonUtc(key).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
}

// ── Instants ↔ store-local wall time ────────────────────────────────────────

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(instant: Date, tz: string): ZonedParts {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(tz, fmt);
  }
  const parts = fmt.formatToParts(instant);
  const pick = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: pick("year"), month: pick("month"), day: pick("day"),
    hour: pick("hour") % 24, minute: pick("minute"), second: pick("second"),
  };
}

// The calendar date an instant falls on in `tz`.
export function dateKeyInTz(instant: Date | string | number, tz: string): string {
  const p = zonedParts(new Date(instant), tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function todayKeyInTz(tz: string, now: Date | number = Date.now()): string {
  return dateKeyInTz(now, tz);
}

// Minutes since local midnight of an instant in `tz`.
export function getLocalMinutes(instant: Date | string | number, tz: string): number {
  const p = zonedParts(new Date(instant), tz);
  return p.hour * 60 + p.minute;
}

export function nowMinutesInTz(tz: string, now: Date | number = Date.now()): number {
  return getLocalMinutes(now, tz);
}

// `tz`'s UTC offset (ms, local − UTC) at a given instant.
function offsetMsAt(instantMs: number, tz: string): number {
  const p = zonedParts(new Date(instantMs), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

// The instant at which the store's wall clock reads `minutes` past midnight on
// `dateKey`. Correct across DST: a wall time skipped by spring-forward moves
// forward by the length of the gap (2:30 → 3:30, as Temporal's "compatible"
// mode does); an ambiguous fall-back time resolves to its first occurrence.
export function zonedTimeToUtc(dateKey: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateKey.slice(0, 10).split("-").map(Number);
  const wallMs = Date.UTC(y, m - 1, d, 0, minutes, 0, 0);
  // The offsets in force a day either side of this wall time (as Temporal
  // does). Offsets never exceed ±14h, so the true instant lies inside that
  // window, and it holds at most one transition: the answer uses one of these.
  const offBefore = offsetMsAt(wallMs - 86_400_000, tz);
  const offAfter = offsetMsAt(wallMs + 86_400_000, tz);
  const candidates = [wallMs - offBefore, wallMs - offAfter];
  for (const c of candidates) {
    if (c + offsetMsAt(c, tz) === wallMs) return new Date(c); // reads `minutes` on the wall
  }
  // Wall time falls in a spring-forward gap: shift by the gap.
  return new Date(wallMs - offBefore);
}

// Real elapsed minutes of a shift scheduled on `dateKey` from `startMinutes` to
// `endMinutes` (store wall clock). Differs from end − start when the shift
// spans a DST change: midnight–8 AM is 9h on a fall-back night, 7h on a
// spring-forward night.
export function shiftElapsedMinutes(dateKey: string, startMinutes: number, endMinutes: number, tz: string): number {
  const start = zonedTimeToUtc(dateKey, startMinutes, tz).getTime();
  const end = zonedTimeToUtc(dateKey, endMinutes, tz).getTime();
  return Math.round((end - start) / 60_000);
}

// Signed real minutes from a scheduled wall-clock time to an instant (positive
// = after the scheduled time, i.e. late). Instant-based so it stays right
// across DST: on a fall-back night a 1:30 AM shift starts at the *first* 1:30,
// and arriving at the repeated 1:30 is an hour late.
export function minutesFromScheduled(
  instant: Date | string | number,
  dateKey: string,
  scheduledMinutes: number,
  tz: string,
): number {
  const scheduled = zonedTimeToUtc(dateKey, scheduledMinutes, tz).getTime();
  return Math.round((new Date(instant).getTime() - scheduled) / 60_000);
}

// UTC instants bounding a full local calendar day in `tz` (inclusive end).
// Handles 23- and 25-hour DST days.
export function localDayBoundsUtc(dateKey: string, tz: string): { start: Date; end: Date } {
  const start = zonedTimeToUtc(dateKey, 0, tz);
  const nextStart = zonedTimeToUtc(addDaysToKey(dateKey, 1), 0, tz);
  return { start, end: new Date(nextStart.getTime() - 1) };
}

// Parse "HH:MM" (24h) into minutes since midnight, or null if malformed.
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatTimeInTz(
  instant: Date | string | number,
  tz: string,
  opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
): string {
  return new Date(instant).toLocaleTimeString("en-US", { ...opts, timeZone: tz });
}

// ── Browser calendar-day Date objects ───────────────────────────────────────
// UI components (date pickers, week/month grids) hold the selected *calendar
// day* as a JS Date. Those Dates are interpreted by their local Y/M/D fields
// only — never converted through a timezone — and are pinned to local noon so
// setDate()/getDay() arithmetic never slips across a DST midnight.

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// Today in the store's timezone, as a local-noon calendar-day Date.
export function storeToday(tz: string, now: Date | number = Date.now()): Date {
  return dateFromKey(todayKeyInTz(tz, now));
}

// ── Timezone catalogue (for pickers) ────────────────────────────────────────

// "UTC+05:45"-style label for a zone's offset at `now`.
export function utcOffsetLabel(tz: string, now: Date | number = Date.now()): string {
  const offMin = Math.round(offsetMsAt(new Date(now).getTime(), tz) / 60_000);
  const sign = offMin < 0 ? "−" : "+";
  const abs = Math.abs(offMin);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// ICU (and so Intl.supportedValuesOf) still lists some zones under their old
// names; show the current IANA name instead when the runtime accepts it.
const CURRENT_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Coral_Harbour": "America/Atikokan",
};

// Every IANA timezone the runtime knows, sorted by current UTC offset then name.
export function allTimezones(now: Date | number = Date.now()): { value: string; label: string; offsetMin: number }[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  zones = zones.map((z) => (CURRENT_ZONE_NAMES[z] && isValidTimezone(CURRENT_ZONE_NAMES[z]) ? CURRENT_ZONE_NAMES[z] : z));
  if (!zones.includes("UTC")) zones = [...zones, "UTC"];
  zones = [...new Set(zones)];
  const t = new Date(now).getTime();
  return zones
    .filter(isValidTimezone)
    .map((value) => ({
      value,
      offsetMin: Math.round(offsetMsAt(t, value) / 60_000),
      label: `(${utcOffsetLabel(value, t)}) ${value.replace(/_/g, " ")}`,
    }))
    .sort((a, b) => a.offsetMin - b.offsetMin || a.value.localeCompare(b.value));
}
