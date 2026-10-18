"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, LayoutGroup } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";
const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };
import AppShell from "../../components/AppShell";
import DemoBanner from "@/components/DemoBanner";
import HeaderActions from "../../components/HeaderActions";
import InviteSheet from "../../components/InviteSheet";
import StoreHoursSection from "../../components/StoreHoursSection";
import { getMonogram, fmtMinutes, AvailabilityRecord } from "../../data/types";
import AvailabilitySection from "../../components/AvailabilitySection";
import SaveStatusText, { type SaveStatus } from "../../components/SaveStatusText";
import SettingsSectionLabel from "../../components/SettingsSectionLabel";
import CalendarSyncSection from "../../components/CalendarSyncSection";
import EmployeeSchedulingRow from "../../components/EmployeeSchedulingRow";
import SchedulingRulesSection from "../../components/SchedulingRulesSection";
import ShiftPreferencesSection from "../../components/ShiftPreferencesSection";
import GeofenceMap from "../../components/GeofenceMap";
import { SkeletonSettingsBody } from "../../components/Skeleton";
import { useTheme, type ThemeMode } from "../../components/ThemeProvider";
import { useAppData } from "../../lib/AppDataContext";
import { isSoundEnabled, setSoundEnabled as persistSoundEnabled } from "../../lib/sound-preference";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "../../lib/punch-policy";
import { DEFAULT_SCHEDULING_RULES, type EmployeeLimitColumns, type SchedulingRules } from "../../lib/scheduling-rules";
import { addDaysToKey, allTimezones, dayOfWeekForKey, DEFAULT_TIMEZONE, todayKeyInTz } from "../../lib/dates";
import StableLabel from "@/components/StableLabel";
import FormError from "@/components/FormError";
import { Toast, ToastStack } from "@/components/Toast";

// Templates are applied to the 7 days starting at a chosen date: default to
// the next start of the store's week (its "first day of week" setting) on or
// after today, in the store's timezone.
function upcomingWeekStartKey(tz: string, firstDayOfWeek: number): string {
  const today = todayKeyInTz(tz);
  return addDaysToKey(today, (firstDayOfWeek - dayOfWeekForKey(today) + 7) % 7);
}

type NominatimAddress = {
  house_number?: string; road?: string;
  city?: string; town?: string; village?: string; hamlet?: string;
  suburb?: string; municipality?: string;
  state?: string; country?: string;
};
type NominatimResult = { lat: string; lon: string; display_name: string; address?: NominatimAddress };

function shortAddress(r: NominatimResult): string {
  const a = r.address;
  if (!a) return r.display_name.split(", ").slice(0, 3).join(", ");
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const city   = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality;
  const region = a.state ?? a.country;
  return [street, city, region].filter(Boolean).join(", ") || r.display_name.split(", ")[0];
}

const DAY_SHORT  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Common zones pinned to the top of the picker; every other IANA zone the
// browser knows is listed below them.
const TIMEZONE_OPTIONS = [
  { label: "Eastern (ET)",  value: "America/New_York" },
  { label: "Central (CT)",  value: "America/Chicago" },
  { label: "Mountain (MT)", value: "America/Denver" },
  { label: "Pacific (PT)",  value: "America/Los_Angeles" },
  { label: "Alaska (AKT)",  value: "America/Anchorage" },
  { label: "Hawaii (HST)",  value: "Pacific/Honolulu" },
  { label: "London (GMT)",  value: "Europe/London" },
  { label: "Paris (CET)",   value: "Europe/Paris" },
  { label: "Tokyo (JST)",   value: "Asia/Tokyo" },
  { label: "Sydney (AEDT)", value: "Australia/Sydney" },
];

const FIRST_DAY_OPTIONS = [
  { label: "Sunday",   value: 0 },
  { label: "Monday",   value: 1 },
  { label: "Saturday", value: 6 },
];

type Employee = EmployeeLimitColumns & { id: number; name: string; email: string | null; user_id: string | null };

// Top-level grouping divider — sits above a cluster of related settings
// sections to give the page a clear two-tier hierarchy (group → section → card).
/** Anchor id for a settings group, used by the section nav on wide screens. */
function groupId(label: string) {
  return `settings-${label.toLowerCase()}`;
}

// A row that opens another page or a sheet: the same as Store Hours' and
// Availability's day rows, edge to edge in its card, with a chevron.
const linkRow =
  "flex items-center w-full px-4 py-3.5 gap-3 bg-transparent border-none cursor-pointer text-left hover:bg-fill/30 transition-colors";
const chevron = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-fg-subtle shrink-0"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

function SettingsGroupHeader({ label }: { label: string }) {
  return (
    <div id={groupId(label)} className="flex items-center gap-3 mt-3 first:mt-0 select-none scroll-mt-24">
      <span className="text-sm font-bold text-fg tracking-tight">{label}</span>
      <div className="flex-1 h-px bg-fill" />
    </div>
  );
}

const DEFAULT_STORE_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480, close: 1200 }, 1: { open: 360, close: 1320 }, 2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 }, 4: { open: 360, close: 1320 }, 5: { open: 360, close: 1320 },
  6: { open: 360, close: 1200 },
};

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

function EmployeeAvailabilityRow({
  employeeId,
  storeHours,
}: {
  employeeId: number;
  storeHours: Record<number, { open: number; close: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<AvailabilityRecord[] | null>(null);
  const fetchedRef = useRef(false);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !fetchedRef.current) {
        fetchedRef.current = true;
        fetch(`/api/availability?employeeId=${employeeId}`)
          .then((r) => r.json())
          .then((data: AvailabilityRecord[]) => setRecords(Array.isArray(data) ? data : []))
          .catch(() => setRecords([]));
      }
      return next;
    });
  }

  const restricted = (records ?? []).filter(
    (r) => r.startMinutes !== null || r.endMinutes !== null || (r.startMinutes === null && r.endMinutes === null)
  );
  const restrictedDows = new Set(restricted.map((r) => r.dayOfWeek));
  const freeDows = [0, 1, 2, 3, 4, 5, 6].filter((d) => !restrictedDows.has(d));
  const allFree = records !== null && restricted.length === 0;

  return (
    <div data-testid={`employee-avail-${employeeId}`} className="px-4 pb-3 pt-0">
      <button
        onClick={toggle}
        aria-expanded={expanded}
        aria-label="Toggle typical week"
        className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg-muted cursor-pointer bg-transparent border-none transition-colors py-2 -my-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`transition-transform ${expanded ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>Typical Week</span>
      </button>

      {expanded && (
        <div className="mt-2 pl-1">
          {records === null ? (
            <div role="status" className="text-xs text-fg-subtle">Loading…</div>
          ) : allFree ? (
            <div className="text-xs text-fg-subtle">No restrictions set</div>
          ) : (
            <div className="flex flex-col gap-2">
              {restricted.map((rec) => {
                const hours = storeHours[rec.dayOfWeek] ?? DEFAULT_STORE_HOURS[rec.dayOfWeek];
                const isOff = rec.startMinutes === null || rec.endMinutes === null;
                return (
                  <div key={rec.dayOfWeek} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-fg-muted w-7 shrink-0">
                        {DAY_SHORT[rec.dayOfWeek]}
                      </span>
                      {isOff ? (
                        <span className="text-xs text-fg-subtle">Unavailable</span>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="flex-1 min-w-0">
                            {(() => {
                              const total = hours.close - hours.open;
                              if (total <= 0) return null;
                              const s = rec.startMinutes!;
                              const e = rec.endMinutes!;
                              const bPct = clamp((s - hours.open) / total * 100, 0, 100);
                              const wPct = clamp((e - s) / total * 100, 0, 100);
                              const aPct = clamp(100 - bPct - wPct, 0, 100);
                              return (
                                <div
                                  className="flex h-1 rounded-full overflow-hidden gap-px"
                                  aria-label={`${DAY_SHORT[rec.dayOfWeek]} availability bar`}
                                >
                                  {bPct > 0 && <div className="bg-fill-strong/60" style={{ width: `${bPct}%` }} />}
                                  {wPct > 0 && <div className="bg-success/70" style={{ width: `${wPct}%` }} />}
                                  {aPct > 0 && <div className="bg-fill-strong/60" style={{ width: `${aPct}%` }} />}
                                </div>
                              );
                            })()}
                          </div>
                          <span className="text-[11px] text-fg-muted shrink-0 tabular-nums">
                            {fmtMinutes(rec.startMinutes!)} – {fmtMinutes(rec.endMinutes!)}
                          </span>
                        </div>
                      )}
                    </div>
                    {rec.note && (
                      <div className="text-[11px] text-fg-subtle italic pl-9">{rec.note}</div>
                    )}
                  </div>
                );
              })}
              {freeDows.length > 0 && (
                <div className="text-[11px] text-fg-subtle">
                  {freeDows.map((d) => DAY_SHORT[d]).join(", ")} — no restrictions
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPageClient({
  isManagerInitial = false,
}: {
  isManagerInitial?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { me, refreshSettings } = useAppData();
  const isDemo = me.isDemo;

  // ── Sounds ────────────────────────────────────────────────────────────────
  // Device-local preference (localStorage); initialized after mount to avoid an
  // SSR/client hydration mismatch.
  const [soundEnabled, setSoundEnabled] = useState(true);
  useEffect(() => { setSoundEnabled(isSoundEnabled()); }, []);
  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    persistSoundEnabled(next);
  }

  // ── Coverage ────────────────────────────────────────────────────────────────
  const [coverageAlertsEnabled, setCoverageAlertsEnabled] = useState(true);
  const [coverageAlertsSaving, setCoverageAlertsSaving] = useState(false);

  async function saveCoverageAlerts(newValue: boolean) {
    setCoverageAlertsSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverageAlertsEnabled: newValue }),
    });
    setCoverageAlertsSaving(false);
  }

  // ── Week Start ──────────────────────────────────────────────────────────────
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [firstDayStatus, setFirstDayStatus] = useState<SaveStatus>("idle");

  async function saveFirstDay(value: number) {
    setFirstDayOfWeek(value);
    setFirstDayStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstDayOfWeek: value }),
    });
    if (res.ok) {
      setFirstDayStatus("saved");
      setTimeout(() => setFirstDayStatus("idle"), 2000);
    } else {
      setFirstDayStatus("error");
      setTimeout(() => setFirstDayStatus("idle"), 4000);
    }
  }

  // ── Timezone ────────────────────────────────────────────────────────────────
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [timezoneStatus, setTimezoneStatus] = useState<SaveStatus>("idle");
  const allTimezoneOptions = useMemo(() => allTimezones(), []);

  async function saveTimezone(value: string) {
    setTimezone(value);
    setTimezoneStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: value }),
    });
    if (res.ok) {
      // Every screen derives "today" and local times from the shared settings —
      // refresh them so the new zone applies without a reload.
      refreshSettings();
      setTimezoneStatus("saved");
      setTimeout(() => setTimezoneStatus("idle"), 2000);
    } else {
      setTimezoneStatus("error");
      setTimeout(() => setTimezoneStatus("idle"), 4000);
    }
  }

  // ── Time Clock ─────────────────────────────────────────────────────────────
  const [manualPunchesEnabled, setManualPunchesEnabled] = useState(true);
  const [gpsRequired, setGpsRequired] = useState(false);
  const [timeclockSaving, setTimeclockSaving] = useState(false);
  const [timeclockSaved, setTimeclockSaved] = useState(false);

  // ── Geofence ────────────────────────────────────────────────────────────────
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [geofenceLat, setGeofenceLat] = useState<number | null>(null);
  const [geofenceLng, setGeofenceLng] = useState<number | null>(null);
  const [geofenceRadius, setGeofenceRadius] = useState(100);
  const [geofenceAddress, setGeofenceAddress] = useState<string | null>(null);
  const [geofenceZoom, setGeofenceZoom] = useState(15);
  const [geofenceSaving, setGeofenceSaving] = useState(false);
  const [geofenceSaved, setGeofenceSaved] = useState(false);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [gettingLocation, setGettingLocation] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleAddressInput(value: string) {
    setAddressInput(value);
    setShowSuggestions(false);
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
    if (!value.trim() || value.length < 2) { setAddressSuggestions([]); return; }
    const currentLat = geofenceLat;
    const currentLng = geofenceLng;
    autocompleteTimerRef.current = setTimeout(async () => {
      try {
        const viewbox = currentLat !== null && currentLng !== null
          ? `&viewbox=${currentLng - 0.5},${currentLat + 0.5},${currentLng + 0.5},${currentLat - 0.5}`
          : "";
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value.trim())}&format=json&limit=5&addressdetails=1${viewbox}`,
          { headers: { "Accept-Language": "en" } }
        );
        const results: NominatimResult[] = await res.json();
        setAddressSuggestions(results);
        if (results.length > 0) setShowSuggestions(true);
      } catch { /* silent */ }
    }, 200);
  }

  // Cancel any pending debounced autocomplete fetch on unmount.
  useEffect(() => () => {
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
  }, []);

  function selectSuggestion(result: NominatimResult) {
    const label = shortAddress(result);
    setGeofenceLat(parseFloat(result.lat));
    setGeofenceLng(parseFloat(result.lon));
    setGeofenceAddress(label);
    setAddressInput(label);
    setShowSuggestions(false);
    setAddressSuggestions([]);
    setGeofenceError(null);
  }

  async function reverseGeocode(lat: number, lon: number): Promise<string> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data: NominatimResult = await res.json();
      return shortAddress(data);
    } catch {
      return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  }

  async function placeAtCoords(lat: number, lon: number) {
    setGeofenceLat(lat);
    setGeofenceLng(lon);
    const label = await reverseGeocode(lat, lon);
    setGeofenceAddress(label);
    setAddressInput(label);
    setGeofenceError(null);
  }

  function captureCurrentLocation() {
    if (!navigator.geolocation) {
      setGeofenceError("Geolocation is not supported by your browser.");
      return;
    }
    setGettingLocation(true);
    setGeofenceError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await placeAtCoords(pos.coords.latitude, pos.coords.longitude);
        setGettingLocation(false);
      },
      () => {
        setGeofenceError("Location access denied. Enable location in your browser settings.");
        setGettingLocation(false);
      },
      { timeout: 8000 }
    );
  }

  async function saveGeofence() {
    if (geofenceLat === null || geofenceLng === null) return;
    setGeofenceSaving(true);
    setGeofenceError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geofenceLat,
        geofenceLng,
        geofenceRadius,
        geofenceAddress: (geofenceAddress ?? addressInput.trim()) || null,
      }),
    });
    setGeofenceSaving(false);
    if (res.ok) {
      setGeofenceSaved(true);
      setTimeout(() => setGeofenceSaved(false), 2000);
    } else {
      setGeofenceError("Failed to save geofence settings.");
    }
  }

  async function saveTimeclockSetting(patch: { manualPunchesEnabled?: boolean; gpsRequired?: boolean; geofenceEnabled?: boolean }) {
    setTimeclockSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setTimeclockSaving(false);
    if (res.ok) {
      setTimeclockSaved(true);
      setTimeout(() => setTimeclockSaved(false), 2000);
    }
  }

  // ── Punch Violations ─────────────────────────────────────────────────────────
  const [punchPolicy, setPunchPolicy] = useState<PunchPolicy>(DEFAULT_PUNCH_POLICY);
  const [schedulingRules, setSchedulingRules] = useState<SchedulingRules>(DEFAULT_SCHEDULING_RULES);
  const [punchPolicyStatus, setPunchPolicyStatus] = useState<SaveStatus>("idle");

  // Optimistically apply a policy patch, then persist it. Reverts on failure.
  async function savePunchPolicy(patch: Partial<PunchPolicy>) {
    const prev = punchPolicy;
    const next = { ...punchPolicy, ...patch };
    setPunchPolicy(next);
    setPunchPolicyStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ punchPolicy: patch }),
    }).catch(() => null);
    if (res?.ok) {
      setPunchPolicyStatus("saved");
      setTimeout(() => setPunchPolicyStatus("idle"), 2000);
    } else {
      setPunchPolicy(prev);
      setPunchPolicyStatus("error");
      setTimeout(() => setPunchPolicyStatus("idle"), 4000);
    }
  }

  // ── Employees ───────────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState<Employee | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Push Notifications ──────────────────────────────────────────────────────
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setPushSupported(true);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setPushSubscribed(!!sub))
    );
  }, []);

  // ── Notification Preferences ─────────────────────────────────────────────────
  type NotifPrefs = {
    latePunchAlerts: boolean;
    messageAlerts: boolean;
    chessAlerts: boolean;
    ptoAlerts: boolean;
    newShiftAlerts: boolean;
    shiftChangeAlerts: boolean;
    swapAlerts: boolean;
    shiftReminderAlerts: boolean;
  };
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    latePunchAlerts: true,
    messageAlerts: true,
    chessAlerts: true,
    ptoAlerts: true,
    newShiftAlerts: true,
    shiftChangeAlerts: true,
    swapAlerts: true,
    shiftReminderAlerts: true,
  });
  const [notifPrefsSaving, setNotifPrefsSaving] = useState<Partial<Record<keyof NotifPrefs, boolean>>>({});

  useEffect(() => {
    fetch("/api/notification-preferences")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((prefs: NotifPrefs) => setNotifPrefs(prefs))
      .catch(() => {});
  }, []);

  async function toggleNotifPref(key: keyof NotifPrefs) {
    const next = !notifPrefs[key];
    setNotifPrefs((p) => ({ ...p, [key]: next }));
    setNotifPrefsSaving((s) => ({ ...s, [key]: true }));
    const res = await fetch("/api/notification-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setNotifPrefs((p) => ({ ...p, [key]: !next }));
    }
    setNotifPrefsSaving((s) => ({ ...s, [key]: false }));
  }

  const [weeklyHours, setWeeklyHours] = useState<Record<number, { open: number; close: number }>>(DEFAULT_STORE_HOURS);

  // Supabase Realtime — live updates for employees and store hours
  useEffect(() => {
    function refetchEmployees() {
      fetch("/api/employees")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((emps: Employee[]) => setEmployees(emps))
        .catch(() => {});
    }

    function refetchStoreHours() {
      fetch("/api/store-hours")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
        .catch(() => {});
    }

    const channel = supabase
      .channel("settings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refetchEmployees)
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, refetchStoreHours)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(b64);
    const buf = new ArrayBuffer(raw.length);
    const output = new Uint8Array(buf);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  async function togglePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setPushSaving(true);
    setPushError(null);
    try {
      if (pushSubscribed) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        }
        setPushSubscribed(false);
      } else {
        if ("Notification" in window && Notification.permission === "default") {
          const result = await Notification.requestPermission();
          if (result !== "granted") {
            setPushError("Permission denied. Enable notifications in your device Settings.");
            setPushSaving(false);
            return;
          }
        }
        if ("Notification" in window && Notification.permission === "denied") {
          setPushError("Permission denied. Enable notifications in your device Settings.");
          setPushSaving(false);
          return;
        }
        const keyRes = await fetch("/api/push/vapid-key");
        if (!keyRes.ok) { setPushError("Push notifications are not configured on this server."); setPushSaving(false); return; }
        const { publicKey } = await keyRes.json();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setPushSubscribed(true);
      }
    } catch (err) {
      console.error("[push] toggle failed:", err);
      if ((err as { name?: string }).name === "NotAllowedError") {
        setPushError("Permission denied. Enable notifications in your device Settings.");
      } else {
        setPushError((err as Error).message ?? "Failed to update push notifications.");
      }
    } finally {
      setPushSaving(false);
    }
  }

  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(isManagerInitial);
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  // ── Danger Zone ─────────────────────────────────────────────────────────────
  const [isOwner, setIsOwner] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [confirmDeleteOrg, setConfirmDeleteOrg] = useState(false);
  const [orgNameInput, setOrgNameInput] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);
  const [deleteOrgError, setDeleteOrgError] = useState<string | null>(null);

  type Template = { id: number; name: string; rowCount: number };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyDateInput, setApplyDateInput] = useState<Record<number, string>>({});
  const [applyError, setApplyError] = useState<Record<number, string | null>>({});
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);

  // ── Initial data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    // The page shows once both the store's settings and the identity are in:
    // the settings decide, among other things, the order of the availability
    // days (the week start), which mustn't change under the reader.
    const settingsLoad = fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.firstDayOfWeek  != null) setFirstDayOfWeek(s.firstDayOfWeek);
        if (s.coverageAlertsEnabled != null) setCoverageAlertsEnabled(s.coverageAlertsEnabled);
        if (s.timezone)                setTimezone(s.timezone);
        if (s.manualPunchesEnabled != null) setManualPunchesEnabled(s.manualPunchesEnabled);
        if (s.gpsRequired != null) setGpsRequired(s.gpsRequired);
        if (s.geofenceEnabled != null) setGeofenceEnabled(s.geofenceEnabled);
        if (s.geofenceLat     != null) setGeofenceLat(s.geofenceLat);
        if (s.geofenceLng     != null) setGeofenceLng(s.geofenceLng);
        if (s.geofenceRadius  != null) setGeofenceRadius(s.geofenceRadius);
        if (s.geofenceAddress != null) {
          setGeofenceAddress(s.geofenceAddress);
          setAddressInput(s.geofenceAddress);
        }
        if (s.punchPolicy) setPunchPolicy(s.punchPolicy);
        if (s.schedulingRules) setSchedulingRules({ ...DEFAULT_SCHEDULING_RULES, ...s.schedulingRules });
      })
      .catch(() => {});
    fetch("/api/employees")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((emps: Employee[]) => setEmployees(emps))
      .catch(() => {});
    const meLoad = fetch("/api/me")
      .then((r) => r.json())
      .then(({ isManager: mgr, employeeId: empId, isOwner: owner, orgName: org }) => {
        if (mgr != null) setIsManager(mgr);
        if (empId != null) setEmployeeId(empId);
        setIsOwner(!!owner);
        setOrgName(org ?? null);
        if (mgr) {
          fetch("/api/templates")
            .then((r) => r.ok ? r.json() : Promise.reject())
            .then(({ templates: t }) => setTemplates(t ?? []))
            .catch(() => {});
          fetch("/api/store-hours")
            .then((r) => r.ok ? r.json() : Promise.reject())
            .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
            .catch(() => {});
        }
      })
      .catch(() => {});
    Promise.allSettled([settingsLoad, meLoad]).then(() => setLoading(false));
  }, []);

  // ── Employee actions ────────────────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function saveEditName(id: number) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditError("Name cannot be empty"); return; }
    setEditSaving(true);
    setEditError(null);
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: trimmed }),
    });
    setEditSaving(false);
    if (res.ok) {
      setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, name: trimmed } : e));
      setEditingId(null);
    } else {
      const json = await res.json().catch(() => ({}));
      setEditError(json.error ?? "Failed to save");
    }
  }

  async function deleteEmployee(id: number) {
    setConfirmDeleteEmployee(null);
    setDeletingId(id);
    setDeleteErrorId(null);
    const res = await fetch("/api/employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== id));
    } else {
      setDeleteErrorId(id);
      setTimeout(() => setDeleteErrorId(null), 3000);
    }
  }

  // ── Danger Zone actions ─────────────────────────────────────────────────────
  async function deleteAccount() {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    const res = await fetch("/api/account", { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      await supabase.auth.signOut();
      window.location.href = "/login";
      return;
    }
    const json = await res?.json().catch(() => ({}));
    setDeleteAccountError(json?.error ?? "Failed to delete account");
    setDeletingAccount(false);
  }

  async function deleteOrganization() {
    setDeletingOrg(true);
    setDeleteOrgError(null);
    const res = await fetch("/api/organizations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: orgNameInput.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      // The caller keeps their account but has no membership here anymore;
      // the landing page routes org-less users to sign-up/onboarding.
      window.location.href = "/";
      return;
    }
    const json = await res?.json().catch(() => ({}));
    setDeleteOrgError(json?.error ?? "Failed to delete organization");
    setDeletingOrg(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Group headers in render order, for the section nav shown from the desk size up.
  const groups = ["Preferences", ...(isManager ? ["Workplace", "Team"] : []), "Account"];

  /*
   * Phones: a full-screen sheet that slides in over the current page.
   * Tablet and up: an ordinary page beside the nav rail / sidebar (the
   * overlay, slide-in transform and shadow are switched off with tablet:
   * overrides), with a sticky section nav from the desk size up.
   */
  return (
    <AppShell active="settings" isManager={isManager}>
    <motion.div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-scrim/60 backdrop-blur-sm
                 tablet:static tablet:z-auto tablet:block tablet:bg-transparent tablet:backdrop-blur-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
    <motion.div role="main"
      className="relative w-full max-w-[480px] h-full bg-bg overflow-y-auto flex flex-col
                 tablet:max-w-none tablet:h-auto tablet:min-h-dvh tablet:overflow-visible tablet:shadow-none! tablet:transform-none!"
      style={{ boxShadow: "var(--shadow-dialog)" }}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.8 }}
    >
      <DemoBanner />
      {/* Header */}
      <div
        className="sticky top-0 z-20 px-4 pb-3 flex items-center gap-3 border-b border-line bg-bg shrink-0 tablet:px-6 desk:py-[14px]"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={() => router.back()}
          className="tablet:hidden size-11 rounded-xl bg-card border border-line text-fg-muted flex items-center justify-center cursor-pointer shrink-0 hover:bg-fill hover:text-fg-body transition-colors"
          aria-label="Back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="flex-1 text-xl font-extrabold text-fg tracking-tight">Settings</span>
        <HeaderActions className="hidden tablet:flex" />
      </div>

      <div className="tablet:px-2 desk:grid desk:grid-cols-[180px_minmax(0,720px)] desk:justify-center desk:gap-10 desk:px-6">
      {!loading && (
        <nav aria-label="Settings sections" className="hidden desk:flex flex-col gap-0.5 sticky top-14 self-start pt-5">
          {groups.map((g) => (
            <a
              key={g}
              href={`#${groupId(g)}`}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-fg-muted hover:text-fg hover:bg-fill transition-colors"
            >
              {g}
            </a>
          ))}
        </nav>
      )}

      {loading ? (
        <div className="px-4 pt-5 desk:col-start-2"><SkeletonSettingsBody isManager={isManager} /></div>
      ) : null}

      <div className={`px-4 pt-5 pb-12 flex flex-col gap-5 min-w-0 tablet:max-w-[720px] tablet:mx-auto tablet:w-full desk:mx-0 desk:col-start-2${loading ? " hidden" : ""}`}>

        {/* ── Preferences (personal, all users) ── */}
        <SettingsGroupHeader label="Preferences" />

        {/* My Availability — shown to all linked employees */}
        {employeeId !== null && (
          <AvailabilitySection
            employeeId={employeeId}
            weeklyHours={weeklyHours}
            firstDayOfWeek={firstDayOfWeek}
          />
        )}

        {/* Shift preferences — what the employee would like; used by Auto-schedule */}
        {employeeId !== null && (
          <ShiftPreferencesSection employeeId={employeeId} firstDayOfWeek={firstDayOfWeek} />
        )}

        {/* Calendar subscription — anyone with a schedule */}
        {employeeId !== null && <CalendarSyncSection />}

        {/* Appearance — all users */}
        <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Appearance
          </div>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4">
            <LayoutGroup id="theme-pill">
            <div className="flex bg-fill rounded-xl p-[3px] gap-[3px]">
              {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setThemeMode(m)}
                  aria-pressed={themeMode === m}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 min-h-11 px-2.5 rounded-[9px] text-sm font-semibold cursor-pointer z-10 transition-colors ${themeMode === m ? "text-fg" : "text-fg-muted"}`}
                >
                  {themeMode === m && (
                    <motion.div
                      layoutId="theme-active"
                      className="absolute inset-0 rounded-[9px] bg-fill-stronger"
                      style={{ boxShadow: "var(--shadow-segment)" }}
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                  {m === "light" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  {m === "dark" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {m === "system" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  <span className="capitalize">{m}</span>
                  </span>
                </button>
              ))}
            </div>
            </LayoutGroup>
          </div>
        </section>

        {/* Sounds — all users (device-local) */}
        <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Sounds
          </div>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-fg-body">Sound Effects</div>
                <div className="text-xs text-fg-subtle mt-0.5">Punch, message, and notification sounds on this device</div>
              </div>
              <button
                role="switch"
                aria-label="Sound effects"
                aria-checked={soundEnabled}
                data-testid="toggle-sound-effects"
                onClick={toggleSound}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                  soundEnabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                    soundEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Push Notifications — all users */}
        {pushSupported && (
          <section>
            <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
              Notifications
            </div>
            <div className="bg-card rounded-2xl border border-line/60 px-4 py-4">
              {/* Master push toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-fg-body">Push Notifications</div>
                  <div className="text-xs text-fg-subtle mt-0.5">Receive alerts on this device when the app is closed</div>
                </div>
                <button
                  role="switch"
                  aria-label="Push notifications"
                  aria-checked={pushSubscribed}
                  disabled={pushSaving}
                  aria-busy={pushSaving}
                  onClick={togglePush}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                    pushSubscribed ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                      pushSubscribed ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Per-type toggles — only visible when push is enabled */}
              {pushSubscribed && (
                <div className="mt-4 pt-4 border-t border-line space-y-0">
                  {(
                    [
                      ...( isManager ? [
                        { key: "latePunchAlerts"     as const, label: "Late Punch Alerts",    desc: "Notify when an employee clocks in late" },
                        { key: "newShiftAlerts"      as const, label: "New Shift Alerts",     desc: "Notify when a new schedule is published" },
                        { key: "shiftChangeAlerts"   as const, label: "Shift Change Alerts",  desc: "Notify when a shift is modified" },
                        { key: "swapAlerts"          as const, label: "Swap Request Alerts",  desc: "Notify on swap approvals and denials" },
                        { key: "ptoAlerts"           as const, label: "Time Off & Call-Out Alerts", desc: "Notify on time off decisions and when someone calls out" },
                        { key: "shiftReminderAlerts" as const, label: "Shift Reminders",      desc: "Remind you before an upcoming shift" },
                      ] : [
                        { key: "newShiftAlerts"      as const, label: "New Shift Alerts",     desc: "Notify when a new schedule is published" },
                        { key: "shiftChangeAlerts"   as const, label: "Shift Change Alerts",  desc: "Notify when your shift is modified" },
                        { key: "swapAlerts"          as const, label: "Swap Request Alerts",  desc: "Notify on swap approvals and denials" },
                        { key: "ptoAlerts"           as const, label: "Time Off Alerts",      desc: "Notify on time off approvals and denials" },
                        { key: "shiftReminderAlerts" as const, label: "Shift Reminders",      desc: "Remind you before an upcoming shift" },
                      ]),
                      { key: "messageAlerts" as const, label: "Message Alerts", desc: "Notify when you receive a new message" },
                      { key: "chessAlerts"   as const, label: "Chess Alerts",   desc: "Notify when your chess opponent makes a move" },
                    ] as { key: keyof NotifPrefs; label: string; desc: string }[]
                  ).map(({ key, label, desc }, i, arr) => (
                    <div
                      key={key}
                      className={`flex items-center justify-between py-3 ${i < arr.length - 1 ? "border-b border-line/60" : ""}`}
                    >
                      <div>
                        <div className="text-sm font-medium text-fg-secondary">{label}</div>
                        <div className="text-xs text-fg-subtle mt-0.5">{desc}</div>
                      </div>
                      <button
                        role="switch"
                        aria-label={label}
                        aria-checked={notifPrefs[key]}
                        disabled={!!notifPrefsSaving[key]}
                        onClick={() => toggleNotifPref(key)}
                        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-4 after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                          notifPrefs[key] ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                            notifPrefs[key] ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Workplace (org-level config, manager only) ── */}
        {isManager && <SettingsGroupHeader label="Workplace" />}

        {/* Store Hours — manager only */}
        {isManager && (
        <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Store Hours
          </div>
          <StoreHoursSection firstDayOfWeek={firstDayOfWeek} />
        </section>
        )}

        {/* Coverage — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Coverage Thresholds
          </div>
          <div className="bg-card rounded-2xl border border-line/60 overflow-hidden divide-y divide-line/60">
            {/* Parent toggle */}
            <div className="flex items-center justify-between gap-3 px-4 py-4">
              <div>
                <div className="text-sm font-semibold text-fg-body">Coverage Alerts</div>
                <div className="text-xs text-fg-subtle mt-0.5">Show banners when staffing is low</div>
              </div>
              <button
                role="switch"
                aria-label="Coverage alerts"
                aria-checked={coverageAlertsEnabled}
                disabled={coverageAlertsSaving}
                onClick={() => {
                  const next = !coverageAlertsEnabled;
                  setCoverageAlertsEnabled(next);
                  saveCoverageAlerts(next);
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                  coverageAlertsEnabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                  coverageAlertsEnabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>

            <button
              data-testid="coverage-profiles-link"
              onClick={() => router.push("/coverage")}
              className={linkRow}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-fg-body">Coverage Profiles</div>
                <div className="text-xs text-fg-subtle mt-0.5">Target staffing curves per day, in 15-minute steps</div>
              </div>
              {chevron}
            </button>
          </div>
        </section>}

        {/* Scheduling Rules — manager only. What Auto-schedule (Week page, Draft mode) works within. */}
        {isManager && (
          <SchedulingRulesSection
            rules={schedulingRules}
            onSaved={(next) => { setSchedulingRules(next); refreshSettings(); }}
          />
        )}

        {/* Time Clock — manager only */}
        {isManager && <section>
          <SettingsSectionLabel label="Time Clock">
            <div role="status" aria-live="polite" aria-atomic="true" className="text-xs leading-4">
              {timeclockSaved && <div className="text-success-fg">Saved ✓</div>}
            </div>
          </SettingsSectionLabel>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-line/60">
              <div>
                <div className="text-sm font-semibold text-fg-body">Allow Manual Punch Corrections</div>
                <div className="text-xs text-fg-subtle mt-0.5">Employees can report missed punches</div>
              </div>
              <button
                role="switch"
                aria-label="Allow manual punch corrections"
                aria-checked={manualPunchesEnabled}
                disabled={timeclockSaving}
                data-testid="toggle-manual-punches"
                onClick={() => {
                  const next = !manualPunchesEnabled;
                  setManualPunchesEnabled(next);
                  saveTimeclockSetting({ manualPunchesEnabled: next });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                  manualPunchesEnabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                    manualPunchesEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <div className={`flex items-center justify-between gap-3 ${gpsRequired ? "pb-4 border-b border-line/60" : ""}`}>
              <div>
                <div className="text-sm font-semibold text-fg-body">Require GPS for Clock-In</div>
                <div className="text-xs text-fg-subtle mt-0.5">Block clock-in if location is denied</div>
              </div>
              <button
                role="switch"
                aria-label="Require GPS for clock-in"
                aria-checked={gpsRequired}
                disabled={timeclockSaving}
                data-testid="toggle-gps-required"
                onClick={() => {
                  const next = !gpsRequired;
                  setGpsRequired(next);
                  saveTimeclockSetting({ gpsRequired: next });
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                  gpsRequired ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                    gpsRequired ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Geofence enforcement — only visible when GPS is required */}
            {gpsRequired && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-fg-body">Enforce Geofence</div>
                    <div className="text-xs text-fg-subtle mt-0.5">Only allow clock-in within a set radius</div>
                  </div>
                  <button
                    role="switch"
                    aria-label="Enforce geofence"
                    aria-checked={geofenceEnabled}
                    disabled={timeclockSaving || geofenceSaving}
                    data-testid="toggle-geofence-enabled"
                    onClick={() => {
                      const next = !geofenceEnabled;
                      setGeofenceEnabled(next);
                      saveTimeclockSetting({ geofenceEnabled: next });
                      if (next && geofenceLat === null) captureCurrentLocation();
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                      geofenceEnabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
                        geofenceEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {geofenceEnabled && (
                  <div className="space-y-3 pt-1">
                    {/* Address autocomplete */}
                    <div className="relative">
                      <div className="text-xs text-fg-muted mb-1.5">Location</div>
                      <div className="flex gap-2">
                        <input
                          aria-label="Search geofence address"
                          value={addressInput}
                          onChange={(e) => handleAddressInput(e.target.value)}
                          onFocus={() => { setAddressInput(""); setShowSuggestions(false); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                          placeholder="Search address…"
                          className="flex-1 bg-fill border border-field rounded-lg px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
                        />
                        <button
                          onClick={captureCurrentLocation}
                          disabled={gettingLocation}
                          title="Use my current location"
                          className="size-11 shrink-0 rounded-lg bg-fill-strong border border-line-stronger text-fg-body flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-fill-stronger transition-colors"
                        >
                          {gettingLocation ? (
                            <span className="text-xs font-bold">…</span>
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2"/>
                              <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      {showSuggestions && addressSuggestions.length > 0 && (
                        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-fill border border-line-strong rounded-xl shadow-xl overflow-hidden">
                          {addressSuggestions.map((s, i) => (
                            <button
                              key={i}
                              onMouseDown={() => selectSuggestion(s)}
                              className="w-full text-left px-3 py-3 text-sm text-fg-body hover:bg-fill-strong transition-colors border-b border-line-strong/50 last:border-0 cursor-pointer leading-snug"
                            >
                              {shortAddress(s)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {geofenceLat !== null && geofenceLng !== null && (
                      <>
                        <GeofenceMap
                          lat={geofenceLat}
                          lng={geofenceLng}
                          radius={geofenceRadius}
                          zoom={geofenceZoom}
                          onLocationChange={(lat, lng) => placeAtCoords(lat, lng)}
                          onZoomChange={setGeofenceZoom}
                        />

                        {/* Radius control */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-fg-muted">Geofence Radius</span>
                            <span className="text-xs font-bold text-fg-body tabular-nums">{geofenceRadius}m</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setGeofenceRadius((r) => Math.max(50, r - 25))}
                              aria-label="Decrease geofence radius"
                              className="size-11 rounded-lg bg-fill border border-line-strong text-fg-secondary text-xl flex items-center justify-center cursor-pointer select-none hover:bg-fill-strong transition-colors"
                            >
                              −
                            </button>
                            <input
                              type="range"
                              min="50"
                              max="5000"
                              step="25"
                              value={geofenceRadius}
                              aria-label="Geofence radius in meters"
                              onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                              className="flex-1 accent-accent"
                            />
                            <button
                              onClick={() => setGeofenceRadius((r) => Math.min(5000, r + 25))}
                              aria-label="Increase geofence radius"
                              className="size-11 rounded-lg bg-fill border border-line-strong text-fg-secondary text-xl flex items-center justify-center cursor-pointer select-none hover:bg-fill-strong transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <div className="flex justify-between text-[10px] text-fg-subtle mt-1 px-0.5" aria-hidden="true">
                            <span>50m</span>
                            <span>5km</span>
                          </div>
                        </div>
                      </>
                    )}

                    <FormError message={geofenceError} />

                    <button
                      onClick={saveGeofence}
                      disabled={geofenceSaving || geofenceLat === null || geofenceLng === null}
                      aria-busy={geofenceSaving}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-accent/20 text-accent-fg border border-accent/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-accent/30 transition-colors"
                    >
                      {geofenceSaving ? "Saving…" : geofenceSaved ? "Saved ✓" : "Save Geofence"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>}

        {/* Punch Violations — manager only. Orgs precisely define what counts as
            a violation and cap breaks per shift (enforced at clock-in time). */}
        {isManager && <section>
          <SettingsSectionLabel label="Punch Violations">
            <SaveStatusText status={punchPolicyStatus} testId="punch-policy-status" />
          </SettingsSectionLabel>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-4">
            {([
              { enabledKey: "lateInEnabled",     minutesKey: "lateInMinutes",     label: "Late Clock-In",   desc: "Flag when clocking in past the scheduled start" },
              { enabledKey: "earlyInEnabled",    minutesKey: "earlyInMinutes",    label: "Early Clock-In",  desc: "Flag when clocking in before the scheduled start" },
              { enabledKey: "lateOutEnabled",    minutesKey: "lateOutMinutes",    label: "Late Clock-Out",  desc: "Flag when clocking out past the scheduled end" },
              { enabledKey: "earlyOutEnabled",   minutesKey: "earlyOutMinutes",   label: "Early Clock-Out", desc: "Flag when clocking out before the scheduled end" },
              { enabledKey: "longBreakEnabled",  minutesKey: "longBreakMinutes",  label: "Long Break",      desc: "Flag breaks longer than the limit" },
              { enabledKey: "shortBreakEnabled", minutesKey: "shortBreakMinutes", label: "Short Break",     desc: "Flag breaks shorter than the minimum" },
              { enabledKey: "ncnsEnabled",       minutesKey: "ncnsMinutes",       label: "No Call No Show", desc: "Flag a scheduled shift with no punch and no call-out" },
            ] as { enabledKey: keyof PunchPolicy; minutesKey: keyof PunchPolicy; label: string; desc: string }[]).map(
              ({ enabledKey, minutesKey, label, desc }, i, arr) => {
                const enabled = punchPolicy[enabledKey] as boolean;
                const minutes = punchPolicy[minutesKey] as number;
                return (
                  <div key={enabledKey} className={`flex items-center justify-between gap-3 ${i < arr.length - 1 ? "pb-4 border-b border-line/60" : ""}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-fg-body">{label}</div>
                      <div className="text-xs text-fg-subtle mt-0.5">{desc}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {enabled && (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={1440}
                            aria-label={`${label} threshold in minutes`}
                            value={minutes}
                            onChange={(e) => setPunchPolicy((p) => ({ ...p, [minutesKey]: Number(e.target.value) }))}
                            onBlur={(e) => {
                              const v = clamp(Math.round(Number(e.target.value) || 0), 1, 1440);
                              if (v !== (DEFAULT_PUNCH_POLICY[minutesKey] as number) || v !== minutes) savePunchPolicy({ [minutesKey]: v } as Partial<PunchPolicy>);
                            }}
                            className="w-16 bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg text-right tabular-nums focus:outline-none focus:border-accent"
                          />
                          <span className="text-xs text-fg-subtle">min</span>
                        </div>
                      )}
                      <button
                        role="switch"
                        aria-label={label}
                        aria-checked={enabled}
                        onClick={() => savePunchPolicy({ [enabledKey]: !enabled } as Partial<PunchPolicy>)}
                        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
                          enabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>
                );
              }
            )}

            {/* Max breaks per shift — a hard cap enforced by the punch state machine */}
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-line">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg-body">Max Breaks Per Shift</div>
                <div className="text-xs text-fg-subtle mt-0.5">Block extra breaks at clock-in time · 0 = unlimited</div>
              </div>
              <input
                type="number"
                min={0}
                max={20}
                aria-label="Max breaks per shift"
                value={punchPolicy.maxBreaksPerShift}
                onChange={(e) => setPunchPolicy((p) => ({ ...p, maxBreaksPerShift: Number(e.target.value) }))}
                onBlur={(e) => {
                  const v = clamp(Math.round(Number(e.target.value) || 0), 0, 20);
                  savePunchPolicy({ maxBreaksPerShift: v });
                }}
                className="w-16 bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg text-right tabular-nums focus:outline-none focus:border-accent shrink-0"
              />
            </div>
          </div>
        </section>}

        {/* Week Start — manager only */}
        {isManager && <section>
          <SettingsSectionLabel label="Week Start">
            <SaveStatusText status={firstDayStatus} testId="week-start-status" />
          </SettingsSectionLabel>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4">
            <LayoutGroup id="week-start-pill">
            <div className="flex bg-fill rounded-xl p-[3px] gap-[3px]">
              {FIRST_DAY_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => saveFirstDay(value)}
                  aria-pressed={firstDayOfWeek === value}
                  className={`relative flex-1 min-h-11 px-2.5 rounded-[9px] text-sm font-semibold cursor-pointer z-10 transition-colors ${firstDayOfWeek === value ? "text-fg" : "text-fg-muted"}`}
                >
                  {firstDayOfWeek === value && (
                    <motion.div
                      layoutId="week-start-active"
                      className="absolute inset-0 rounded-[9px] bg-fill-stronger"
                      style={{ boxShadow: "var(--shadow-segment)" }}
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>
            </LayoutGroup>
          </div>
        </section>}

        {/* Timezone — manager only */}
        {isManager && <section>
          <SettingsSectionLabel label="Timezone">
            <SaveStatusText status={timezoneStatus} testId="timezone-status" />
          </SettingsSectionLabel>
          <div className="bg-card rounded-2xl border border-line/60 px-4 py-4">
            <select
              aria-label="Timezone"
              value={timezone}
              onChange={(e) => saveTimezone(e.target.value)}
              className="w-full bg-fill border border-field rounded-xl px-3 py-2.5 text-sm text-fg cursor-pointer focus:outline-none focus:border-accent transition-colors"
            >
              <optgroup label="Common">
                {TIMEZONE_OPTIONS.map(({ label, value }) => (
                  <option key={value} value={value}>{label} — {value}</option>
                ))}
              </optgroup>
              <optgroup label="All timezones">
                {allTimezoneOptions
                  .filter((o) => !TIMEZONE_OPTIONS.some((c) => c.value === o.value))
                  .map(({ label, value }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </optgroup>
              {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) &&
                !allTimezoneOptions.some((o) => o.value === timezone) && (
                <option value={timezone}>{timezone}</option>
              )}
            </select>
          </div>
        </section>}

        {/* ── Team (people & access, manager only) ── */}
        {isManager && <SettingsGroupHeader label="Team" />}

        {/* Employees — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Employees
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="w-full mb-2 py-3 rounded-2xl bg-transparent border border-dashed border-line-strong text-fg-muted font-semibold text-sm cursor-pointer hover:border-line-stronger hover:text-fg-secondary transition-colors"
          >
            + Add Employee
          </button>
          <motion.div className="bg-card rounded-2xl border border-line/60 overflow-hidden divide-y divide-line/60" variants={listContainer} initial="hidden" animate="show">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-fg-subtle">No employees</div>
            ) : (
              employees.map((emp) => (
                <motion.div key={emp.id} variants={listItem} className="flex flex-col">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="size-9 rounded-full bg-accent-solid/90 border border-accent/30 flex items-center justify-center text-xs font-bold text-on-accent shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    {editingId === emp.id ? (
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                        <input
                          autoFocus
                          aria-label={`Edit name for ${emp.name}`}
                          value={editingName}
                          onChange={(e) => { setEditingName(e.target.value); setEditError(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditName(emp.id); if (e.key === "Escape") setEditingId(null); }}
                          className="w-full bg-fill border border-field rounded-lg px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:border-accent transition-colors"
                        />
                        <FormError message={editError} />
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-fg-body truncate" title={emp.name}>{emp.name}</div>
                        {emp.email && <div className="text-xs text-fg-subtle truncate" title={emp.email}>{emp.email}</div>}
                      </div>
                    )}
                    {editingId === emp.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => saveEditName(emp.id)}
                          disabled={editSaving}
                          aria-busy={editSaving}
                          className="h-10 text-xs font-semibold px-3 rounded-lg bg-accent/20 text-accent-fg border border-accent/30 hover:bg-accent/30 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <StableLabel labels={["Save", "…"]} active={editSaving ? 1 : 0} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="h-10 text-xs font-semibold px-3 rounded-lg bg-fill-strong text-fg-secondary border border-line-stronger cursor-pointer hover:bg-fill-stronger transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => { setEditingId(emp.id); setEditingName(emp.name); setEditError(null); }}
                          className="size-10 rounded-lg bg-fill border border-line-strong text-fg-muted hover:text-fg-body flex items-center justify-center cursor-pointer transition-colors"
                          aria-label={`Edit name for ${emp.name}`}
                          aria-expanded={editingId === emp.id}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        {emp.user_id !== null && emp.user_id === currentUserId ? (
                          <button
                            disabled
                            aria-label="Cannot remove yourself"
                            className="size-10 rounded-lg border border-danger/10 bg-danger/5 text-danger-fg/30 flex items-center justify-center cursor-not-allowed opacity-40"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteEmployee(emp)}
                            disabled={deletingId === emp.id}
                            aria-label={`Remove ${emp.name}`}
                            className={`size-10 rounded-lg border flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              deleteErrorId === emp.id
                                ? "bg-danger/20 text-danger-fg-strong border-danger/40"
                                : "bg-danger/10 text-danger-fg border-danger/20 hover:bg-danger/20"
                            }`}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isManager && (
                    <EmployeeAvailabilityRow employeeId={emp.id} storeHours={weeklyHours} />
                  )}
                  {isManager && (
                    <EmployeeSchedulingRow
                      employee={emp}
                      rules={schedulingRules}
                      firstDayOfWeek={firstDayOfWeek}
                      onSaved={(fields) => setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, ...fields } : e)))}
                    />
                  )}
                </motion.div>
              ))
            )}
          </motion.div>
        </section>}

        {/* Templates — manager only */}
        {isManager && (
          <section>
            <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
              Schedule Templates
            </div>
            <motion.div className="bg-card rounded-2xl border border-line/60 overflow-hidden divide-y divide-line/60" variants={listContainer} initial="hidden" animate="show">
              {templates.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-fg-subtle">No templates yet</div>
              ) : (
                templates.map((tpl) => (
                  <motion.div key={tpl.id} variants={listItem} className="flex flex-col px-4 py-3 gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-fg-body">{tpl.name}</div>
                        <div className="text-xs text-fg-subtle mt-0.5">{tpl.rowCount} row{tpl.rowCount !== 1 ? "s" : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: applyDateInput[tpl.id] ? "" : upcomingWeekStartKey(timezone, firstDayOfWeek) }))}
                          aria-label={`Apply ${tpl.name} template`}
                          aria-expanded={!!(applyDateInput[tpl.id] !== undefined && applyDateInput[tpl.id] !== "")}
                          className="h-10 text-xs font-semibold px-3 rounded-lg bg-accent/20 text-accent-fg border border-accent/30 hover:bg-accent/30 cursor-pointer transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          onClick={async () => {
                            setDeletingTemplateId(tpl.id);
                            await fetch(`/api/templates/${tpl.id}`, { method: "DELETE" });
                            setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
                            setDeletingTemplateId(null);
                          }}
                          disabled={deletingTemplateId === tpl.id}
                          aria-label={`Delete ${tpl.name} template`}
                          aria-busy={deletingTemplateId === tpl.id}
                          className="h-10 text-xs font-semibold px-3 rounded-lg bg-danger/10 text-danger-fg border border-danger/20 hover:bg-danger/20 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <StableLabel labels={["Delete", "…"]} active={deletingTemplateId === tpl.id ? 1 : 0} />
                        </button>
                      </div>
                    </div>
                    {applyDateInput[tpl.id] !== undefined && applyDateInput[tpl.id] !== "" && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-fg-muted shrink-0">Week starting</span>
                        <input
                          type="date"
                          aria-label={`Apply date for ${tpl.name ?? "schedule template"}`}
                          value={applyDateInput[tpl.id]}
                          onChange={(e) => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                          className="flex-1 bg-fill border border-field rounded-lg px-2 py-1.5 text-sm text-fg focus:outline-none focus:border-accent transition-colors"
                        />
                        <button
                          disabled={applyingId === tpl.id}
                          aria-busy={applyingId === tpl.id}
                          onClick={async () => {
                            setApplyingId(tpl.id);
                            setApplyError((prev) => ({ ...prev, [tpl.id]: null }));
                            const res = await fetch(`/api/templates/${tpl.id}/apply`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ weekStartDate: applyDateInput[tpl.id] }),
                            });
                            setApplyingId(null);
                            if (!res.ok) {
                              const { error } = await res.json().catch(() => ({}));
                              setApplyError((prev) => ({ ...prev, [tpl.id]: error ?? "Failed to apply template" }));
                              return;
                            }
                            setApplyDateInput((prev) => ({ ...prev, [tpl.id]: "" }));
                          }}
                          className="h-10 text-xs font-semibold px-3 rounded-lg bg-success/20 text-success-fg border border-success/30 cursor-pointer hover:bg-success/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <StableLabel labels={["Confirm", "Applying…"]} active={applyingId === tpl.id ? 1 : 0} />
                        </button>
                      </div>
                    )}
                    {/* The line is held while the date picker is open, so a
                        failed apply doesn't grow the row. */}
                    {(applyError[tpl.id] || (applyDateInput[tpl.id] !== undefined && applyDateInput[tpl.id] !== "")) && (
                      <FormError message={applyError[tpl.id]} />
                    )}
                  </motion.div>
                ))
              )}
            </motion.div>
          </section>
        )}

        {/* Admin */}
        {isManager && (
        <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Admin
          </div>
          <div className="bg-card rounded-2xl border border-line/60 overflow-hidden divide-y divide-line/60">
            <button onClick={() => router.push("/reports")} className={linkRow}>
              <span className="flex-1 text-sm font-semibold text-fg-body">View Reports</span>
              {chevron}
            </button>
            <button onClick={() => router.push("/admin")} className={linkRow}>
              <span className="flex-1 text-sm font-semibold text-fg-body">Manage Roles</span>
              {chevron}
            </button>
          </div>
        </section>
        )}

        {/* ── Account (all users) ── */}
        <SettingsGroupHeader label="Account" />

        {/* Sign out */}
        <section className="pb-2">
          <button
            onClick={handleSignOut}
            className="w-full py-3 rounded-2xl bg-card border border-line/60 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </section>

        {/* Danger Zone — hidden in demo (anonymous throwaway sessions) */}
        {!isDemo && (
          <section className="pb-2">
            <div className="text-[11px] text-danger-fg font-semibold tracking-wider uppercase mb-2 px-1">
              Danger Zone
            </div>
            <div className="flex flex-col gap-2">
              {isOwner && (
                <button
                  data-testid="delete-organization-button"
                  onClick={() => {
                    setOrgNameInput("");
                    setDeleteOrgError(null);
                    setConfirmDeleteOrg(true);
                  }}
                  className="w-full py-3 rounded-2xl bg-card border border-danger/20 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
                >
                  Delete Organization
                </button>
              )}
              <button
                data-testid="delete-account-button"
                onClick={() => {
                  setDeleteAccountError(null);
                  setConfirmDeleteAccount(true);
                }}
                className="w-full py-3 rounded-2xl bg-card border border-danger/20 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
              >
                Delete Account
              </button>
            </div>
          </section>
        )}
      </div>
      </div>

      <InviteSheet
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSuccess={() => {
          // The sheet stays open on its confirmation until Done.
          fetch("/api/employees")
            .then((r) => r.ok ? r.json() : Promise.reject())
            .then(setEmployees)
            .catch(() => {});
        }}
      />

      {/* Delete account confirmation modal */}
      {confirmDeleteAccount && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "color-mix(in oklab, var(--color-scrim) 60%, transparent)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!deletingAccount) setConfirmDeleteAccount(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-account-heading"
            className="w-full max-w-[440px] bg-card border border-line-strong rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-danger/15 border border-danger/25 flex items-center justify-center text-2xl" aria-hidden="true">
                ⚠️
              </div>
              <div>
                <div id="confirm-delete-account-heading" className="text-base font-bold text-fg">Delete your account?</div>
                <div className="text-sm text-fg-muted mt-1">
                  Your login and personal data will be permanently deleted. This cannot be undone.
                  {isOwner
                    ? " You own this organization — delete the organization first."
                    : " Your organization keeps its schedule and time clock records."}
                </div>
              </div>
              <FormError message={deleteAccountError} />
            </div>
            <div className="flex border-t border-line">
              <button
                onClick={() => setConfirmDeleteAccount(false)}
                autoFocus
                disabled={deletingAccount}
                className="flex-1 py-3.5 text-sm font-semibold text-fg-secondary hover:bg-fill transition-colors cursor-pointer border-r border-line disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={deleteAccount}
                disabled={deletingAccount}
                aria-busy={deletingAccount}
                className="flex-1 py-3.5 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingAccount ? "Deleting…" : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete organization confirmation modal */}
      {confirmDeleteOrg && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "color-mix(in oklab, var(--color-scrim) 60%, transparent)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!deletingOrg) setConfirmDeleteOrg(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-org-heading"
            className="w-full max-w-[440px] bg-card border border-line-strong rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-danger/15 border border-danger/25 flex items-center justify-center text-2xl" aria-hidden="true">
                ⚠️
              </div>
              <div>
                <div id="confirm-delete-org-heading" className="text-base font-bold text-fg">
                  Delete {orgName ?? "this organization"}?
                </div>
                <div className="text-sm text-fg-muted mt-1">
                  All employees, schedules, time clock records, and settings will be permanently
                  deleted for everyone in the organization. This cannot be undone.
                </div>
              </div>
              <div className="w-full text-left">
                <label htmlFor="confirm-org-name" className="text-xs text-fg-muted">
                  Type <span className="font-semibold text-fg-secondary">{orgName ?? "the organization name"}</span> to confirm
                </label>
                <input
                  id="confirm-org-name"
                  autoFocus
                  value={orgNameInput}
                  onChange={(e) => setOrgNameInput(e.target.value)}
                  placeholder={orgName ?? "Organization name"}
                  className="mt-1.5 w-full bg-fill border border-field rounded-lg px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-danger/70 transition-colors"
                />
              </div>
              <FormError message={deleteOrgError} />
            </div>
            <div className="flex border-t border-line">
              <button
                onClick={() => setConfirmDeleteOrg(false)}
                disabled={deletingOrg}
                className="flex-1 py-3.5 text-sm font-semibold text-fg-secondary hover:bg-fill transition-colors cursor-pointer border-r border-line disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={deleteOrganization}
                disabled={deletingOrg || orgNameInput.trim() !== (orgName ?? "")}
                aria-busy={deletingOrg}
                className="flex-1 py-3.5 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingOrg ? "Deleting…" : "Delete Organization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteEmployee && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "color-mix(in oklab, var(--color-scrim) 60%, transparent)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirmDeleteEmployee(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-heading"
            className="w-full max-w-[440px] bg-card border border-line-strong rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-danger/15 border border-danger/25 flex items-center justify-center text-2xl" aria-hidden="true">
                ⚠️
              </div>
              <div>
                <div id="confirm-delete-heading" className="text-base font-bold text-fg">Delete {confirmDeleteEmployee.name}?</div>
                <div className="text-sm text-fg-muted mt-1">
                  This will permanently delete their account and all of their shifts. This cannot be undone.
                </div>
              </div>
            </div>
            <div className="flex border-t border-line">
              <button
                onClick={() => setConfirmDeleteEmployee(null)}
                autoFocus
                className="flex-1 py-3.5 text-sm font-semibold text-fg-secondary hover:bg-fill transition-colors cursor-pointer border-r border-line"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteEmployee(confirmDeleteEmployee.id)}
                className="flex-1 py-3.5 text-sm font-semibold text-danger-fg hover:bg-danger/10 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Over the page, so a failed toggle doesn't push the settings down. */}
      <ToastStack>
        {pushError && <Toast onDismiss={() => setPushError(null)}>{pushError}</Toast>}
      </ToastStack>
    </motion.div>
    </motion.div>
    </AppShell>
  );
}
