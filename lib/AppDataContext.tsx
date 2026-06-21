"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase-browser";
import { getAttendanceStatus, type AttendanceStatus, type Employee, type Schedule, type PunchRecord, type StoreHours } from "@/data/types";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "@/lib/punch-policy";

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
};

export type MeData = {
  isManager: boolean;
  employeeId: number | null;
  employeeName: string | null;
  // True when the session belongs to the demo organization (resolved
  // server-side by /api/me — demo is a real authenticated session now).
  isDemo: boolean;
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
  timezone: "America/New_York",
  emailNotifications: false,
  manualPunchesEnabled: true,
  gpsRequired: false,
  geofenceEnabled: false,
  geofenceLat: null,
  geofenceLng: null,
  geofenceRadius: 100,
  geofenceAddress: null,
  punchPolicy: DEFAULT_PUNCH_POLICY,
};

type AppDataContextValue = {
  me: MeData;
  storeHours: Record<number, StoreHours>;
  settings: AppSettings;
  sharedLoading: boolean;
  refreshMe: () => void;
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
  me: { isManager: false, employeeId: null, employeeName: null, isDemo: false },
  storeHours: DEFAULT_STORE_HOURS,
  settings: DEFAULT_SETTINGS,
  sharedLoading: true,
  refreshMe: () => {},
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

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  // NOTE: do not seed these from readMeCache() in the initializer. localStorage
  // is unavailable during SSR, so the server always renders the default (no
  // manager nav, loading) while a returning manager's client would read the
  // cache and render the manager nav — a hydration mismatch on every load. The
  // cache is applied in the mount effect below, after hydration, so the server
  // and first client render agree.
  const [me, setMe] = useState<MeData>({ isManager: false, employeeId: null, employeeName: null, isDemo: false });
  const [storeHours, setStoreHours] = useState<Record<number, StoreHours>>(DEFAULT_STORE_HOURS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleCache, setScheduleCacheState] = useState<Record<string, Schedule[]>>({});
  const [punchCache, setPunchCacheState] = useState<Record<string, PunchRecord[]>>({});
  const [myScheduleCache, setMyScheduleCacheState] = useState<Record<string, Schedule[]>>({});
  const [liveStatus, setLiveStatus] = useState<AttendanceStatus>("not_clocked_in");

  const applyMe = (data: { isManager?: boolean; employeeId?: number | null; employeeName?: string | null; isDemo?: boolean }) => {
    const newMe: MeData = {
      isManager: !!data.isManager,
      employeeId: data.employeeId ?? null,
      employeeName: data.employeeName ?? null,
      isDemo: !!data.isDemo,
    };
    setMe(newMe);
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

  const refreshStoreHours = useCallback(() => {
    fetch("/api/store-hours")
      .then(r => r.json())
      .then((data: Record<number, StoreHours>) => setStoreHours(prev => ({ ...prev, ...data })))
      .catch(() => {});
  }, []);

  const refreshSettings = useCallback(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((data: AppSettings) => setSettings(data))
      .catch(() => {});
  }, []);

  // Fetch today's punches for the current user and derive the live attendance
  // status. Only meaningful for users linked to an employee record; managers
  // without one keep "not_clocked_in" (no ring). Reads me/timezone via refs so
  // the callback identity stays stable across renders.
  const meRef = useRef(me);
  meRef.current = me;
  const timezoneRef = useRef(settings.timezone);
  timezoneRef.current = settings.timezone;

  const refreshLiveStatus = useCallback(() => {
    const empId = meRef.current.employeeId;
    if (empId === null) {
      setLiveStatus("not_clocked_in");
      return;
    }
    const tz = timezoneRef.current || "America/New_York";
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    fetch(`/api/punches?date=${todayKey}`)
      .then(r => r.json())
      .then((data: PunchRecord[]) => {
        const mine = Array.isArray(data) ? data.filter(p => p.employeeId === empId) : [];
        setLiveStatus(getAttendanceStatus(mine));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Apply the cached identity now (post-hydration) for an instant render on
    // return visits; fall through to the network fetch either way.
    const cached = readMeCache();
    if (cached) {
      setMe(cached);
      setSharedLoading(false);
    }
    Promise.allSettled([
      fetch("/api/me").then(r => r.json()),
      fetch("/api/store-hours").then(r => r.json()),
      fetch("/api/settings").then(r => r.json()),
    ]).then(([meResult, hoursResult, settingsResult]) => {
      if (meResult.status === "fulfilled") applyMe(meResult.value);
      if (hoursResult.status === "fulfilled") setStoreHours(prev => ({ ...prev, ...hoursResult.value }));
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    }).finally(() => setSharedLoading(false));
  }, []);

  // Refresh the live attendance status once we know which employee this is
  // (and whenever that identity changes — e.g. after login or demo heal).
  useEffect(() => {
    refreshLiveStatus();
  }, [me.employeeId, refreshLiveStatus]);

  // React to auth changes. A just-completed login navigates client-side
  // (router.push) without remounting this provider, so the mount-effect above
  // never re-runs — without this the user would stay "unauthenticated" (no
  // avatar, no manager buttons) until a full page refresh.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        refreshMe();
        refreshStoreHours();
        refreshSettings();
        refreshLiveStatus();
      } else if (event === "SIGNED_OUT") {
        applyMe({ isManager: false, employeeId: null, employeeName: null, isDemo: false });
        setLiveStatus("not_clocked_in");
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMe, refreshStoreHours, refreshSettings]);

  // Re-fetch shared data when the tab comes back to the foreground after being hidden
  useEffect(() => {
    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (Date.now() - hiddenAt > 5_000) {
        refreshMe();
        refreshStoreHours();
        refreshSettings();
        refreshLiveStatus();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshMe, refreshStoreHours, refreshSettings, refreshLiveStatus]);

  useEffect(() => {
    const channel = supabase
      .channel("app-data-shared")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, refreshStoreHours)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, refreshSettings)
      .on("postgres_changes", { event: "*", schema: "public", table: "punch_records" }, refreshLiveStatus)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refreshStoreHours, refreshSettings, refreshLiveStatus]);

  return (
    <AppDataContext.Provider value={{
      me, storeHours, settings, sharedLoading,
      refreshMe, refreshStoreHours, refreshSettings,
      liveStatus, setLiveStatus, refreshLiveStatus,
      employees, cacheEmployees,
      scheduleCache, setScheduleCache,
      punchCache, setPunchCache,
      myScheduleCache, setMyScheduleCache,
    }}>
      {children}
    </AppDataContext.Provider>
  );
}
