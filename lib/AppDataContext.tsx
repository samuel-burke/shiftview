"use client";
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { getAttendanceStatus, type AttendanceStatus, type Employee, type Schedule, type PunchRecord, type StoreHours } from "@/data/types";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "@/lib/punch-policy";
import { DEFAULT_SCHEDULING_RULES, type SchedulingRules } from "@/lib/scheduling-rules";
import { DEFAULT_TIMEZONE } from "@/lib/dates";

export type AppSettings = {
  firstDayOfWeek: number;
  coverageAlertsEnabled: boolean;
  timezone: string;
  emailNotifications: boolean;
  manualPunchesEnabled: boolean;
  gpsRequired: boolean;
  geofenceEnabled: boolean;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadius: number;
  geofenceAddress: string | null;
  punchPolicy: PunchPolicy;
  schedulingRules: SchedulingRules;
};

export type OrgSummary = { id: string; name: string; isManager: boolean };

export type MeData = {
  isManager: boolean;
  employeeId: number | null;
  employeeName: string | null;
  // True when the session belongs to the demo organization (resolved
  // server-side by /api/me — demo is a real authenticated session now).
  isDemo: boolean;
  // The organization the app is showing, and every one the user belongs to
  // (the organization switcher appears when there's more than one).
  orgId: string | null;
  organizations: OrgSummary[];
};

const NO_ME: MeData = {
  isManager: false, employeeId: null, employeeName: null, isDemo: false, orgId: null, organizations: [],
};

export const DEFAULT_STORE_HOURS: Record<number, StoreHours> = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

export const DEFAULT_SETTINGS: AppSettings = {
  firstDayOfWeek: 6,
  coverageAlertsEnabled: true,
  timezone: DEFAULT_TIMEZONE,
  emailNotifications: false,
  manualPunchesEnabled: true,
  gpsRequired: false,
  geofenceEnabled: false,
  geofenceLat: null,
  geofenceLng: null,
  geofenceRadius: 100,
  geofenceAddress: null,
  punchPolicy: DEFAULT_PUNCH_POLICY,
  schedulingRules: DEFAULT_SCHEDULING_RULES,
};

// /api/settings fills every field, but a response from an older server (or a
// test double) may predate newer ones; default anything missing.
function withSettingsDefaults(data: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    schedulingRules: { ...DEFAULT_SCHEDULING_RULES, ...data.schedulingRules },
  };
}

type AppDataContextValue = {
  me: MeData;
  storeHours: Record<number, StoreHours>;
  settings: AppSettings;
  sharedLoading: boolean;
  refreshMe: () => void;
  // Switch to another of the user's organizations; reloads the app on success,
  // resolves with an error message otherwise.
  switchOrganization: (orgId: string) => Promise<string | null>;
  refreshStoreHours: () => void;
  refreshSettings: () => void;
  // Current user's live attendance status, derived from today's punches. Shared
  // app-wide so the ambient status ring can be shown on every screen. The clock
  // screen also pushes immediate updates here via setLiveStatus after a punch.
  liveStatus: AttendanceStatus;
  setLiveStatus: (status: AttendanceStatus) => void;
  refreshLiveStatus: () => void;
  // Team page cache — survives navigation so remounting Team is instant
  // employees is written by pageClient after each direct fetch; context is cache-only
  employees: Employee[];
  cacheEmployees: (data: Employee[]) => void;
  scheduleCache: Record<string, Schedule[]>;
  setScheduleCache: (dateKey: string, schedules: Schedule[]) => void;
  punchCache: Record<string, PunchRecord[]>;
  setPunchCache: (dateKey: string, punches: PunchRecord[]) => void;
  // Schedule page cache — keyed by "from:to" date range
  myScheduleCache: Record<string, Schedule[]>;
  setMyScheduleCache: (rangeKey: string, schedules: Schedule[]) => void;
};

const AppDataContext = createContext<AppDataContextValue>({
  me: NO_ME,
  storeHours: DEFAULT_STORE_HOURS,
  settings: DEFAULT_SETTINGS,
  sharedLoading: true,
  refreshMe: () => {},
  switchOrganization: async () => null,
  refreshStoreHours: () => {},
  refreshSettings: () => {},
  liveStatus: "not_clocked_in",
  setLiveStatus: () => {},
  refreshLiveStatus: () => {},
  employees: [],
  cacheEmployees: () => {},
  scheduleCache: {},
  setScheduleCache: () => {},
  punchCache: {},
  setPunchCache: () => {},
  myScheduleCache: {},
  setMyScheduleCache: () => {},
});

export function useAppData() {
  return useContext(AppDataContext);
}

export const ME_CACHE_KEY = "sv_me";

function readMeCache(): MeData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MeData>;
    if (typeof parsed.isManager !== "boolean") return null;
    return {
      isManager: parsed.isManager,
      employeeId: parsed.employeeId ?? null,
      employeeName: parsed.employeeName ?? null,
      isDemo: parsed.isDemo ?? false,
      orgId: parsed.orgId ?? null,
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
    };
  } catch {
    return null;
  }
}

function writeMeCache(data: MeData) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(data)); } catch {}
}

function clearMeCache() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(ME_CACHE_KEY); } catch {}
}

// The org's settings and store hours, remembered like the identity above so a
// return visit renders with the store's real timezone and week start straight
// away — pages derive their date ranges from them, so starting from the
// defaults meant fetching once with the wrong range and again with the right
// one. Tagged with the org so it is only used next to a cached identity for
// that same org (clearing the identity cache retires it too).
const CONFIG_CACHE_KEY = "sv_org_config";
type OrgConfig = { orgId: string; settings: AppSettings; storeHours: Record<number, StoreHours> };

function readConfigCache(orgId: string | null): OrgConfig | null {
  if (typeof window === "undefined" || !orgId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) ?? "null") as Partial<OrgConfig> | null;
    if (!parsed || parsed.orgId !== orgId || !parsed.settings || !parsed.storeHours) return null;
    return {
      orgId,
      settings: withSettingsDefaults(parsed.settings),
      storeHours: { ...DEFAULT_STORE_HOURS, ...parsed.storeHours },
    };
  } catch {
    return null;
  }
}

function writeConfigCache(config: OrgConfig) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config)); } catch {}
}

// Signed-out pages (the root URL serves the landing page too, but only the
// server knows which it rendered) have no identity, settings or live status to
// load.
function isPublicPath(pathname: string | null): boolean {
  return pathname === "/login" || pathname === "/signup" || pathname === "/privacy" ||
    pathname === "/contact" || !!pathname?.startsWith("/auth/");
}

// Identity and org settings change rarely and stream over Realtime while the
// app is open, so a return to the foreground only re-reads them after a longer
// absence. Live data (the attendance status) refreshes after a short one.
const CONFIG_REFRESH_AFTER_MS = 5 * 60_000;
const LIVE_REFRESH_AFTER_MS = 5_000;

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const isPublicPage = isPublicPath(usePathname());

  // NOTE: do not seed these from readMeCache() in the initializer. localStorage
  // is unavailable during SSR, so the server always renders the default (no
  // manager nav, loading) while a returning manager's client would read the
  // cache and render the manager nav — a hydration mismatch on every load. The
  // cache is applied in the mount effect below, after hydration, so the server
  // and first client render agree.
  const [me, setMe] = useState<MeData>(NO_ME);
  const [storeHours, setStoreHours] = useState<Record<number, StoreHours>>(DEFAULT_STORE_HOURS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleCache, setScheduleCacheState] = useState<Record<string, Schedule[]>>({});
  const [punchCache, setPunchCacheState] = useState<Record<string, PunchRecord[]>>({});
  const [myScheduleCache, setMyScheduleCacheState] = useState<Record<string, Schedule[]>>({});
  const [liveStatus, setLiveStatus] = useState<AttendanceStatus>("not_clocked_in");

  // Callbacks read these through refs so their identities stay stable. The
  // settings and store-hours refs are written by their only setters below.
  const meRef = useRef(me);
  meRef.current = me;
  const settingsRef = useRef(settings);
  const storeHoursRef = useRef(storeHours);
  // The employee whose attendance status is loaded (or loading), so a change of
  // identity reloads it and the same identity doesn't.
  const liveStatusFor = useRef<number | null | undefined>(undefined);
  // The first app page loads the shared data; later identity changes go
  // through refreshMe.
  const started = useRef(false);

  // /api/punches/current returns the caller's own current shift — including one
  // still open from before midnight — which decides the status. Only users
  // linked to an employee record have one; managers without one keep
  // "not_clocked_in" (no ring).
  const refreshLiveStatus = useCallback(() => {
    const empId = meRef.current.employeeId;
    liveStatusFor.current = empId;
    if (empId === null) {
      setLiveStatus("not_clocked_in");
      return;
    }
    fetch("/api/punches/current")
      .then(r => r.json())
      .then((data: { punches?: PunchRecord[] }) => {
        const mine = Array.isArray(data?.punches) ? data.punches.filter(p => p.employeeId === empId) : [];
        setLiveStatus(getAttendanceStatus(mine));
      })
      .catch(() => {});
  }, []);

  const rememberConfig = () => {
    const orgId = meRef.current.orgId;
    if (orgId) writeConfigCache({ orgId, settings: settingsRef.current, storeHours: storeHoursRef.current });
  };

  const applyMe = (data: Partial<MeData>) => {
    const newMe: MeData = {
      isManager: !!data.isManager,
      employeeId: data.employeeId ?? null,
      employeeName: data.employeeName ?? null,
      isDemo: !!data.isDemo,
      orgId: data.orgId ?? null,
      organizations: Array.isArray(data.organizations) ? data.organizations : [],
    };
    meRef.current = newMe;
    setMe(newMe);
    // A different employee (sign-in, demo heal, a refreshed identity) needs
    // its own attendance status.
    if (newMe.employeeId !== liveStatusFor.current) refreshLiveStatus();
    if (newMe.employeeId !== null || newMe.isManager) writeMeCache(newMe);
    else {
      clearMeCache();
      healDemoSession();
    }
  };

  // Returning demo visitors can outlive their membership rows: a demo reset
  // wipes the demo org's managers/employees, but the visitor's anonymous auth
  // session survives in their browser (the SQL reset can't delete auth users,
  // and the cron's purge only covers users it saw). They'd land authenticated
  // but org-less, and every org-scoped API would 403. Re-running /api/demo/start
  // re-provisions them; rate-limited per tab so a failing heal can't reload-loop.
  const healDemoSession = () => {
    try {
      const lastAttempt = Number(sessionStorage.getItem("sv_demo_heal") ?? 0);
      if (Date.now() - lastAttempt < 5 * 60_000) return;
    } catch {}
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user?.is_anonymous) return;
      try { sessionStorage.setItem("sv_demo_heal", String(Date.now())); } catch {}
      fetch("/api/demo/start", { method: "POST" })
        .then((res) => { if (res.ok) window.location.reload(); })
        .catch(() => {});
    });
  };

  const refreshMe = useCallback(() => {
    fetch("/api/me")
      .then(r => r.json())
      .then(applyMe)
      .catch(() => {});
  }, []);

  // Every cache in this provider belongs to the current organization, so a
  // switch reloads the app rather than patching state in place.
  const switchOrganization = useCallback(async (orgId: string): Promise<string | null> => {
    const res = await fetch("/api/me/organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      return body?.error ?? "Couldn't switch organizations. Please try again.";
    }
    clearMeCache();
    window.location.assign("/");
    return null;
  }, []);

  const cacheEmployees = useCallback((data: Employee[]) => {
    setEmployees(data);
  }, []);

  const setScheduleCache = useCallback((dateKey: string, schedules: Schedule[]) => {
    setScheduleCacheState(prev => ({ ...prev, [dateKey]: schedules }));
  }, []);

  const setPunchCache = useCallback((dateKey: string, punches: PunchRecord[]) => {
    setPunchCacheState(prev => ({ ...prev, [dateKey]: punches }));
  }, []);

  const setMyScheduleCache = useCallback((rangeKey: string, schedules: Schedule[]) => {
    setMyScheduleCacheState(prev => ({ ...prev, [rangeKey]: schedules }));
  }, []);

  const applyStoreHours = (data: Record<number, StoreHours>) => {
    storeHoursRef.current = { ...storeHoursRef.current, ...data };
    setStoreHours(storeHoursRef.current);
  };

  const applySettings = (data: Partial<AppSettings>) => {
    settingsRef.current = withSettingsDefaults(data);
    setSettings(settingsRef.current);
  };

  const refreshStoreHours = useCallback(() => {
    fetch("/api/store-hours")
      .then(r => r.json())
      .then((data: Record<number, StoreHours>) => { applyStoreHours(data); rememberConfig(); })
      .catch(() => {});
  }, []);

  const refreshSettings = useCallback(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((data: Partial<AppSettings>) => { applySettings(data); rememberConfig(); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isPublicPage || started.current) return;
    started.current = true;
    // Apply the cached identity (and that org's settings) now, post-hydration,
    // for an instant render on return visits; fall through to the network
    // fetch either way.
    const cached = readMeCache();
    if (cached) {
      const config = readConfigCache(cached.orgId);
      if (config) {
        applySettings(config.settings);
        applyStoreHours(config.storeHours);
      }
      meRef.current = cached;
      setMe(cached);
      setSharedLoading(false);
    }
    // The current shift is requested alongside the identity rather than after
    // it: the route already answers for the caller, so nothing here depends on
    // /api/me returning first. Its status shows as soon as the employee is
    // known — from the cache straight away, otherwise from /api/me.
    const live = fetch("/api/punches/current")
      .then(r => r.json() as Promise<{ punches?: PunchRecord[] }>)
      .catch(() => null);
    const showLiveStatus = (empId: number | null) => {
      liveStatusFor.current = empId;
      if (empId === null) {
        setLiveStatus("not_clocked_in");
        return;
      }
      live.then((data) => {
        if (liveStatusFor.current !== empId || !Array.isArray(data?.punches)) return;
        setLiveStatus(getAttendanceStatus(data.punches.filter(p => p.employeeId === empId)));
      });
    };
    if (cached) showLiveStatus(cached.employeeId);

    Promise.allSettled([
      fetch("/api/me").then(r => r.json()),
      fetch("/api/store-hours").then(r => r.json()),
      fetch("/api/settings").then(r => r.json()),
    ]).then(([meResult, hoursResult, settingsResult]) => {
      if (hoursResult.status === "fulfilled") applyStoreHours(hoursResult.value);
      if (settingsResult.status === "fulfilled") applySettings(settingsResult.value);
      if (meResult.status === "fulfilled") {
        const empId: number | null = meResult.value?.employeeId ?? null;
        if (!cached || empId !== cached.employeeId) showLiveStatus(empId);
        applyMe(meResult.value);
        if (hoursResult.status === "fulfilled" && settingsResult.status === "fulfilled") rememberConfig();
      }
    }).finally(() => setSharedLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicPage]);

  // React to auth changes. A just-completed login navigates client-side
  // (router.push) without remounting this provider, so the mount-effect above
  // never re-runs — without this the user would stay "unauthenticated" (no
  // avatar, no manager buttons) until a full page refresh. Supabase also emits
  // SIGNED_IN when it re-validates the stored session — at startup and every
  // time the tab returns to the foreground — and TOKEN_REFRESHED hourly; those
  // change nothing here, so only a different user triggers a reload.
  useEffect(() => {
    let userId: string | null | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user.id ?? null;
      if (event === "SIGNED_OUT") {
        userId = null;
        applyMe(NO_ME);
        return;
      }
      const changed = userId !== undefined && nextId !== userId;
      userId = nextId;
      if (event === "SIGNED_IN" && changed && nextId) {
        refreshMe();
        refreshStoreHours();
        refreshSettings();
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMe, refreshStoreHours, refreshSettings]);

  // Re-fetch shared data when the tab comes back to the foreground after being hidden
  useEffect(() => {
    if (isPublicPage) return;
    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = Date.now() - hiddenAt;
      if (away > CONFIG_REFRESH_AFTER_MS) {
        refreshMe();
        refreshStoreHours();
        refreshSettings();
      }
      if (away > LIVE_REFRESH_AFTER_MS) refreshLiveStatus();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isPublicPage, refreshMe, refreshStoreHours, refreshSettings, refreshLiveStatus]);

  // Live updates, scoped server-side to this org (and to the user's own
  // punches) so Realtime neither checks nor delivers other orgs' changes, and
  // a coworker's punch doesn't refetch this user's status.
  const { orgId, employeeId } = me;
  useEffect(() => {
    if (!orgId) return;
    let channel = supabase
      .channel(`app-data-shared:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours", filter: `org_id=eq.${orgId}` }, refreshStoreHours)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: `org_id=eq.${orgId}` }, refreshSettings);
    if (employeeId !== null) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "punch_records", filter: `employee_id=eq.${employeeId}` }, refreshLiveStatus);
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, employeeId, refreshStoreHours, refreshSettings, refreshLiveStatus]);

  // A new value only when something in it changed, so a provider re-render
  // (e.g. on navigation) doesn't re-render every consumer.
  const value = useMemo(() => ({
    me, storeHours, settings, sharedLoading,
    refreshMe, switchOrganization, refreshStoreHours, refreshSettings,
    liveStatus, setLiveStatus, refreshLiveStatus,
    employees, cacheEmployees,
    scheduleCache, setScheduleCache,
    punchCache, setPunchCache,
    myScheduleCache, setMyScheduleCache,
  }), [
    me, storeHours, settings, sharedLoading,
    refreshMe, switchOrganization, refreshStoreHours, refreshSettings,
    liveStatus, refreshLiveStatus,
    employees, cacheEmployees,
    scheduleCache, setScheduleCache,
    punchCache, setPunchCache,
    myScheduleCache, setMyScheduleCache,
  ]);

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}
