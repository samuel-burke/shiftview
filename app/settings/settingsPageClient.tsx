"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };
import InviteSheet from "../../components/InviteSheet";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import StoreHoursSection from "../../components/StoreHoursSection";
import { getMonogram, fmtMinutes, AvailabilityRecord } from "../../data/types";
import AvailabilitySection from "../../components/AvailabilitySection";
import GeofenceMap from "../../components/GeofenceMap";
import { SkeletonSettingsBody } from "../../components/Skeleton";
import { useTheme, type ThemeMode } from "../../components/ThemeProvider";
import { DEMO_EMPLOYEES, DEMO_STORE_HOURS, DEMO_SETTINGS } from "../../data/demo-fixtures";

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

const RADIUS_PRESETS = [
  { label: "50m",  value: 50 },
  { label: "100m", value: 100 },
  { label: "250m", value: 250 },
  { label: "500m", value: 500 },
  { label: "1km",  value: 1000 },
];

const DAY_SHORT  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

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

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Employee = { id: number; name: string; email: string | null; user_id: string | null };

function SaveStatusText({ status, testId }: { status: SaveStatus; testId: string }) {
  return (
    <div data-testid={testId}>
      {status === "saving" && <div className="text-xs text-slate-400 mt-2 text-right">Saving…</div>}
      {status === "saved"  && <div className="text-xs text-emerald-400 mt-2 text-right">Saved ✓</div>}
      {status === "error"  && <div className="text-xs text-red-400 mt-2 text-right">Failed to save</div>}
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
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 cursor-pointer bg-transparent border-none"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`transition-transform ${expanded ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>Typical Week</span>
      </button>

      {expanded && (
        <div className="mt-2 pl-1">
          {records === null ? (
            <div className="text-xs text-slate-600">Loading…</div>
          ) : allFree ? (
            <div className="text-xs text-slate-500">No restrictions set</div>
          ) : (
            <div className="flex flex-col gap-2">
              {restricted.map((rec) => {
                const hours = storeHours[rec.dayOfWeek] ?? DEFAULT_STORE_HOURS[rec.dayOfWeek];
                const isOff = rec.startMinutes === null || rec.endMinutes === null;
                return (
                  <div key={rec.dayOfWeek} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 w-7 shrink-0">
                        {DAY_SHORT[rec.dayOfWeek]}
                      </span>
                      {isOff ? (
                        <span className="text-xs text-slate-500">Unavailable</span>
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
                                  {bPct > 0 && <div className="bg-slate-700/60" style={{ width: `${bPct}%` }} />}
                                  {wPct > 0 && <div className="bg-emerald-500/70" style={{ width: `${wPct}%` }} />}
                                  {aPct > 0 && <div className="bg-slate-700/60" style={{ width: `${aPct}%` }} />}
                                </div>
                              );
                            })()}
                          </div>
                          <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                            {fmtMinutes(rec.startMinutes!)} – {fmtMinutes(rec.endMinutes!)}
                          </span>
                        </div>
                      )}
                    </div>
                    {rec.note && (
                      <div className="text-[11px] text-slate-500 italic pl-9">{rec.note}</div>
                    )}
                  </div>
                );
              })}
              {freeDows.length > 0 && (
                <div className="text-[11px] text-slate-600">
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
  isDemo = false,
  isManagerInitial = false,
}: {
  isDemo?: boolean;
  isManagerInitial?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  // ── Coverage ────────────────────────────────────────────────────────────────
  const [optimalCoverage, setOptimalCoverage] = useState(3);
  const [minCoverage, setMinCoverage] = useState(2);
  const [coverageStatus, setCoverageStatus] = useState<SaveStatus>("idle");
  const [coverageValidationError, setCoverageValidationError] = useState<string | null>(null);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleCoverageSave(nextOptimal: number, nextMin: number) {
    if (nextMin > nextOptimal) {
      setCoverageValidationError("Minimum cannot exceed optimal");
      if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
      return;
    }
    setCoverageValidationError(null);
    if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
    coverageTimerRef.current = setTimeout(() => doSaveCoverage(nextOptimal, nextMin), 800);
  }

  async function doSaveCoverage(optimal: number, min: number) {
    setCoverageStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setCoverageStatus("saved");
      setTimeout(() => setCoverageStatus("idle"), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optimalCoverage: optimal, minCoverage: min }),
    });
    if (res.ok) {
      setCoverageStatus("saved");
      setTimeout(() => setCoverageStatus("idle"), 2000);
    } else {
      setCoverageStatus("error");
      setTimeout(() => setCoverageStatus("idle"), 4000);
    }
  }

  function stepOptimal(delta: number) {
    const next = Math.max(1, optimalCoverage + delta);
    setOptimalCoverage(next);
    scheduleCoverageSave(next, minCoverage);
  }

  function stepMin(delta: number) {
    const next = Math.max(0, minCoverage + delta);
    setMinCoverage(next);
    scheduleCoverageSave(optimalCoverage, next);
  }

  // ── Week Start ──────────────────────────────────────────────────────────────
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [firstDayStatus, setFirstDayStatus] = useState<SaveStatus>("idle");

  async function saveFirstDay(value: number) {
    setFirstDayOfWeek(value);
    setFirstDayStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setFirstDayStatus("saved");
      setTimeout(() => setFirstDayStatus("idle"), 2000);
      return;
    }
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
  const [timezone, setTimezone] = useState("America/New_York");
  const [timezoneStatus, setTimezoneStatus] = useState<SaveStatus>("idle");

  async function saveTimezone(value: string) {
    setTimezone(value);
    setTimezoneStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setTimezoneStatus("saved");
      setTimeout(() => setTimezoneStatus("idle"), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: value }),
    });
    if (res.ok) {
      setTimezoneStatus("saved");
      setTimeout(() => setTimezoneStatus("idle"), 2000);
    } else {
      setTimezoneStatus("error");
      setTimeout(() => setTimezoneStatus("idle"), 4000);
    }
  }

  // ── Email Notifications ─────────────────────────────────────────────────────
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailNotifSaving, setEmailNotifSaving] = useState(false);
  const [emailNotifSaved, setEmailNotifSaved] = useState(false);

  async function saveEmailNotif(newValue: boolean) {
    setEmailNotifSaving(true);
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setEmailNotifSaving(false);
      setEmailNotifSaved(true);
      setTimeout(() => setEmailNotifSaved(false), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNotifications: newValue }),
    });
    setEmailNotifSaving(false);
    if (res.ok) {
      setEmailNotifSaved(true);
      setTimeout(() => setEmailNotifSaved(false), 2000);
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

  function useCurrentLocation() {
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
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setGeofenceSaving(false);
      setGeofenceSaved(true);
      setTimeout(() => setGeofenceSaved(false), 2000);
      return;
    }
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
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setTimeclockSaving(false);
      setTimeclockSaved(true);
      setTimeout(() => setTimeclockSaved(false), 2000);
      return;
    }
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

  // Supabase Realtime — live updates for employees and store hours
  useEffect(() => {
    if (isDemo) return;

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
  }, [isDemo]);

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
        const keyRes = await fetch("/api/push/vapid-key");
        if (!keyRes.ok) { setPushError("Push notifications are not configured on this server."); return; }
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

  const [loading, setLoading] = useState(!isDemo);
  const [isManager, setIsManager] = useState(isManagerInitial);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<Record<number, { open: number; close: number }>>(DEFAULT_STORE_HOURS);

  type Template = { id: number; name: string; rowCount: number };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyDateInput, setApplyDateInput] = useState<Record<number, string>>({});
  const [applyError, setApplyError] = useState<Record<number, string | null>>({});
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);

  // ── Initial data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDemo) {
      supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    }
    if (!isDemo) {
      fetch("/api/settings")
        .then((r) => r.json())
        .then((s) => {
          if (s.firstDayOfWeek  != null) setFirstDayOfWeek(s.firstDayOfWeek);
          if (s.optimalCoverage != null) setOptimalCoverage(s.optimalCoverage);
          if (s.minCoverage     != null) setMinCoverage(s.minCoverage);
          if (s.timezone)                setTimezone(s.timezone);
          if (s.emailNotifications != null) setEmailNotifications(s.emailNotifications);
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
        })
        .catch(() => {});
      fetch("/api/employees")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((emps: Employee[]) => setEmployees(emps))
        .catch(() => {});
      fetch("/api/me")
        .then((r) => r.json())
        .then(({ isManager: mgr, employeeId: empId }) => {
          if (mgr != null) setIsManager(mgr);
          if (empId != null) setEmployeeId(empId);
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
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setIsManager(true);
      setCurrentUserId("demo-manager");
      setEmployees(DEMO_EMPLOYEES.map(e => ({
        id: e.id,
        name: e.name,
        email: e.email ?? null,
        user_id: e.user_id ?? null,
      })));
      setWeeklyHours(DEMO_STORE_HOURS);
      setOptimalCoverage(DEMO_SETTINGS.optimalCoverage);
      setMinCoverage(DEMO_SETTINGS.minCoverage);
      setTimezone(DEMO_SETTINGS.timezone);
      setFirstDayOfWeek(DEMO_SETTINGS.firstDayOfWeek);
      setManualPunchesEnabled(DEMO_SETTINGS.manualPunchesEnabled);
      setGpsRequired(DEMO_SETTINGS.gpsRequired);
      setEmailNotifications(DEMO_SETTINGS.emailNotifications);
    }
  }, [isDemo]);

  // ── Employee actions ────────────────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function saveEditName(id: number) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditError("Name cannot be empty"); return; }
    setEditSaving(true);
    setEditError(null);
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, name: trimmed } : e));
      setEditSaving(false);
      setEditingId(null);
      return;
    }
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
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setDeletingId(null);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      return;
    }
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

  // ── Render ──────────────────────────────────────────────────────────────────
  const isDesktop = useIsDesktop();

  return (
    <AppShell active="settings" isManager={isManager}>
    <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto pb-28 bg-bg min-h-screen"}`}>
      {/* Demo banner */}
      {isDemo && (
        <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}

      {/* Top bar */}
      {isDesktop ? (
        <div className="border-b border-slate-800 px-6 py-[14px] flex items-center justify-between">
          <span className="text-xl font-extrabold text-slate-100 tracking-tight">Settings</span>
        </div>
      ) : (
        <div
          className="sticky top-0 z-20 px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">Settings</span>
        </div>
      )}

      {loading ? (
        <div className={isDesktop ? "max-w-2xl mx-auto px-6" : ""}><SkeletonSettingsBody isManager={isManager} /></div>
      ) : null}

      <div className={`${isDesktop ? "max-w-2xl mx-auto px-6 pt-5" : "px-4 pt-5"} flex flex-col gap-5${loading ? " hidden" : ""}`}>

        {/* My Availability — shown to all linked employees */}
        {employeeId !== null && (
          <AvailabilitySection
            employeeId={employeeId}
            weeklyHours={weeklyHours}
            firstDayOfWeek={firstDayOfWeek}
            isDemo={isDemo}
          />
        )}

        {/* Appearance — all users */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Appearance
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="text-sm font-semibold text-slate-200 mb-3">Theme</div>
            <div className="flex bg-slate-800 rounded-xl p-[3px]">
              {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setThemeMode(m)}
                  aria-pressed={themeMode === m}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-sm font-semibold transition-colors cursor-pointer ${
                    themeMode === m
                      ? "bg-slate-600 text-slate-100"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {m === "light" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  {m === "dark" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {m === "system" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  <span className="capitalize">{m}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Push Notifications — all users */}
        {pushSupported && (
          <section>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Notifications
            </div>
            <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-200">Push Notifications</div>
                  <div className="text-xs text-slate-500 mt-0.5">Receive alerts on this device when the app is closed</div>
                </div>
                <button
                  role="switch"
                  aria-label="Push notifications"
                  aria-checked={pushSubscribed}
                  disabled={pushSaving}
                  onClick={togglePush}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                    pushSubscribed ? "bg-indigo-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                      pushSubscribed ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {pushError && (
                <div className="text-xs text-red-400 mt-2">{pushError}</div>
              )}
            </div>
          </section>
        )}

        {/* Store Hours — manager only */}
        {isManager && (
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Store Hours
          </div>
          <StoreHoursSection firstDayOfWeek={firstDayOfWeek} isDemo={isDemo} />
        </section>
        )}

        {/* Coverage — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Coverage Thresholds
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold text-slate-200">Optimal coverage</div>
                <div className="text-xs text-slate-500 mt-0.5">Minimum staff for green status</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  data-testid="coverage-optimal-minus"
                  onClick={() => stepOptimal(-1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {optimalCoverage}
                </span>
                <button
                  data-testid="coverage-optimal-plus"
                  onClick={() => stepOptimal(1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Minimum coverage</div>
                <div className="text-xs text-slate-500 mt-0.5">Below this shows red alert</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  data-testid="coverage-min-minus"
                  onClick={() => stepMin(-1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {minCoverage}
                </span>
                <button
                  data-testid="coverage-min-plus"
                  onClick={() => stepMin(1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  +
                </button>
              </div>
            </div>

            {coverageValidationError && (
              <div className="text-xs text-red-400" data-testid="coverage-validation-error">
                {coverageValidationError}
              </div>
            )}
            <SaveStatusText status={coverageStatus} testId="coverage-status" />
          </div>
        </section>}

        {/* Email Notifications — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Notifications
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Email Notifications</div>
                <div className="text-xs text-slate-500 mt-0.5">Send nightly shift reminders to employees</div>
              </div>
              <button
                role="switch"
                aria-label="Email notifications"
                aria-checked={emailNotifications}
                disabled={emailNotifSaving}
                onClick={() => {
                  const newVal = !emailNotifications;
                  setEmailNotifications(newVal);
                  saveEmailNotif(newVal);
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  emailNotifications ? "bg-indigo-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    emailNotifications ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {emailNotifSaved && (
              <div className="text-xs text-emerald-400 mt-2 text-right">Saved</div>
            )}
          </div>
        </section>}

        {/* Time Clock — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Time Clock
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Allow Manual Punch Corrections</div>
                <div className="text-xs text-slate-500 mt-0.5">Employees can report missed punches</div>
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
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  manualPunchesEnabled ? "bg-indigo-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    manualPunchesEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Require GPS for Clock-In</div>
                <div className="text-xs text-slate-500 mt-0.5">Block clock-in if location is denied</div>
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
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  gpsRequired ? "bg-indigo-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    gpsRequired ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Geofence enforcement — only visible when GPS is required */}
            {gpsRequired && (
              <div className="space-y-4 pt-1">
                <div className="h-px bg-slate-800" />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Enforce Geofence</div>
                    <div className="text-xs text-slate-500 mt-0.5">Only allow clock-in within a set radius</div>
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
                      if (next && geofenceLat === null) useCurrentLocation();
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                      geofenceEnabled ? "bg-indigo-500" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                        geofenceEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {geofenceEnabled && (
                  <div className="space-y-3 pt-1">
                    {/* Address autocomplete */}
                    <div className="relative">
                      <div className="text-xs text-slate-400 mb-1.5">Location</div>
                      <div className="flex gap-2">
                        <input
                          value={addressInput}
                          onChange={(e) => handleAddressInput(e.target.value)}
                          onFocus={() => { setAddressInput(""); setShowSuggestions(false); }}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                          placeholder="Search address…"
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
                        />
                        <button
                          onClick={useCurrentLocation}
                          disabled={gettingLocation}
                          title="Use my current location"
                          className="size-10 shrink-0 rounded-lg bg-slate-700 border border-slate-600 text-slate-200 flex items-center justify-center disabled:opacity-50 cursor-pointer hover:bg-slate-600 transition-colors"
                        >
                          {gettingLocation ? (
                            <span className="text-xs font-bold">…</span>
                          ) : (
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2"/>
                              <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      {showSuggestions && addressSuggestions.length > 0 && (
                        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                          {addressSuggestions.map((s, i) => (
                            <button
                              key={i}
                              onMouseDown={() => selectSuggestion(s)}
                              className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0 cursor-pointer leading-snug"
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
                            <span className="text-xs text-slate-400">Geofence Radius</span>
                            <span className="text-xs font-bold text-slate-200 tabular-nums">{geofenceRadius}m</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setGeofenceRadius((r) => Math.max(50, r - 25))}
                              className="size-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xl flex items-center justify-center cursor-pointer select-none"
                            >
                              −
                            </button>
                            <input
                              type="range"
                              min="50"
                              max="5000"
                              step="25"
                              value={geofenceRadius}
                              onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                              className="flex-1 accent-indigo-500"
                            />
                            <button
                              onClick={() => setGeofenceRadius((r) => Math.min(5000, r + 25))}
                              className="size-10 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xl flex items-center justify-center cursor-pointer select-none"
                            >
                              +
                            </button>
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-600 mt-1 px-0.5">
                            <span>50m</span>
                            <span>5km</span>
                          </div>
                        </div>
                      </>
                    )}

                    {geofenceError && (
                      <div className="text-xs text-red-400">{geofenceError}</div>
                    )}

                    <button
                      onClick={saveGeofence}
                      disabled={geofenceSaving || geofenceLat === null || geofenceLng === null}
                      className="w-full py-2.5 rounded-xl text-sm font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 disabled:opacity-50 cursor-pointer hover:bg-indigo-500/30 transition-colors"
                    >
                      {geofenceSaving ? "Saving…" : geofenceSaved ? "Saved ✓" : "Save Geofence"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {timeclockSaved && (
              <div className="text-xs text-emerald-400 text-right">Saved ✓</div>
            )}
          </div>
        </section>}

        {/* Week Start — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Week Start
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex bg-slate-800 rounded-xl p-[3px]">
              {FIRST_DAY_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => saveFirstDay(value)}
                  className={`flex-1 py-2 rounded-[9px] text-sm font-semibold transition-colors cursor-pointer ${
                    firstDayOfWeek === value
                      ? "bg-slate-600 text-slate-100"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <SaveStatusText status={firstDayStatus} testId="week-start-status" />
          </div>
        </section>}

        {/* Timezone — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Timezone
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <select
              aria-label="Timezone"
              value={timezone}
              onChange={(e) => saveTimezone(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 cursor-pointer"
            >
              {TIMEZONE_OPTIONS.map(({ label, value }) => (
                <option key={value} value={value}>{label} — {value}</option>
              ))}
              {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) && (
                <option value={timezone}>{timezone}</option>
              )}
            </select>
            <SaveStatusText status={timezoneStatus} testId="timezone-status" />
          </div>
        </section>}

        {/* Employees — manager only */}
        {isManager && <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Employees
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="w-full mb-2 py-3 rounded-2xl bg-transparent border border-dashed border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer hover:border-slate-600 hover:text-slate-300 transition-colors"
          >
            + Add Employee
          </button>
          <motion.div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60" variants={listContainer} initial="hidden" animate="show">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
            ) : (
              employees.map((emp) => (
                <motion.div key={emp.id} variants={listItem} className="flex flex-col">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    {editingId === emp.id ? (
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => { setEditingName(e.target.value); setEditError(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditName(emp.id); if (e.key === "Escape") setEditingId(null); }}
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-slate-100"
                        />
                        {editError && <div className="text-xs text-red-400">{editError}</div>}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-200 truncate">{emp.name}</div>
                        {emp.email && <div className="text-xs text-slate-500 truncate">{emp.email}</div>}
                      </div>
                    )}
                    {editingId === emp.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => saveEditName(emp.id)}
                          disabled={editSaving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors"
                        >
                          {editSaving ? "…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 border border-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => { setEditingId(emp.id); setEditingName(emp.name); setEditError(null); }}
                          className="size-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                          aria-label="Edit name"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        {emp.user_id === currentUserId ? (
                          <span className="text-xs text-slate-600 px-3 py-1.5">You</span>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteEmployee(emp)}
                            disabled={deletingId === emp.id}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                              deleteErrorId === emp.id
                                ? "bg-red-500/20 text-red-300 border-red-500/40"
                                : "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                            }`}
                          >
                            {deletingId === emp.id ? "…" : deleteErrorId === emp.id ? "Error" : "Remove"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isManager && (
                    <EmployeeAvailabilityRow employeeId={emp.id} storeHours={weeklyHours} />
                  )}
                </motion.div>
              ))
            )}
          </motion.div>
        </section>}

        {/* Templates — manager only */}
        {isManager && (
          <section>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Schedule Templates
            </div>
            <motion.div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60" variants={listContainer} initial="hidden" animate="show">
              {templates.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">No templates yet</div>
              ) : (
                templates.map((tpl) => (
                  <motion.div key={tpl.id} variants={listItem} className="flex flex-col px-4 py-3 gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-200">{tpl.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{tpl.rowCount} row{tpl.rowCount !== 1 ? "s" : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: applyDateInput[tpl.id] ? "" : new Date().toISOString().slice(0, 10) }))}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors"
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
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          {deletingTemplateId === tpl.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                    {applyDateInput[tpl.id] !== undefined && applyDateInput[tpl.id] !== "" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={applyDateInput[tpl.id]}
                          onChange={(e) => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100"
                        />
                        <button
                          disabled={applyingId === tpl.id}
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
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-pointer disabled:opacity-50"
                        >
                          {applyingId === tpl.id ? "Applying…" : "Confirm"}
                        </button>
                      </div>
                    )}
                    {applyError[tpl.id] && (
                      <div className="text-xs text-red-400">{applyError[tpl.id]}</div>
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
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Admin
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => router.push(isDemo ? "/reports?demo=true" : "/reports")}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              View Reports
            </button>
            <button
              onClick={() => router.push(isDemo ? "/admin?demo=true" : "/admin")}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer"
            >
              Manage Roles
            </button>
          </div>
        </section>
        )}

        {/* Sign out / Sign in */}
        <section className="pb-2">
          {isDemo ? (
            <button
              onClick={() => router.push("/login")}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              Sign In
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          )}
        </section>
      </div>

      {!isDesktop && <BottomNav active="settings" />}

      <InviteSheet
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSuccess={() => {
          setShowInvite(false);
          if (!isDemo) {
            fetch("/api/employees")
              .then((r) => r.ok ? r.json() : Promise.reject())
              .then(setEmployees)
              .catch(() => {});
          }
        }}
        onSubmit={isDemo
          ? async (name, email) => {
              setEmployees((prev) => [
                ...prev,
                { id: Date.now(), name, email, user_id: null },
              ]);
            }
          : undefined
        }
      />

      {/* Delete confirmation modal */}
      {confirmDeleteEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirmDeleteEmployee(null)}
        >
          <div
            className="w-full max-w-[440px] bg-card border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center text-2xl">
                ⚠️
              </div>
              <div>
                <div className="text-base font-bold text-slate-100">Delete {confirmDeleteEmployee.name}?</div>
                <div className="text-sm text-slate-400 mt-1">
                  This will permanently delete their account and all of their shifts. This cannot be undone.
                </div>
              </div>
            </div>
            <div className="flex border-t border-slate-800">
              <button
                onClick={() => setConfirmDeleteEmployee(null)}
                className="flex-1 py-3.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer border-r border-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteEmployee(confirmDeleteEmployee.id)}
                className="flex-1 py-3.5 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </AppShell>
  );
}
