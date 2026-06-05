"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { Employee, Schedule, PunchRecord, StoreHours } from "@/data/types";

export type AppSettings = {
  firstDayOfWeek: number;
  optimalCoverage: number;
  minCoverage: number;
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
};

export type MeData = {
  isManager: boolean;
  employeeId: number | null;
  employeeName: string | null;
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
  optimalCoverage: 3,
  minCoverage: 2,
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
};

type AppDataContextValue = {
  me: MeData;
  storeHours: Record<number, StoreHours>;
  settings: AppSettings;
  sharedLoading: boolean;
  refreshMe: () => void;
  refreshStoreHours: () => void;
  refreshSettings: () => void;
  // Team page cache — survives navigation so remounting Team is instant
  employees: Employee[];
  refreshEmployees: () => void;
  scheduleCache: Record<string, Schedule[]>;
  setScheduleCache: (dateKey: string, schedules: Schedule[]) => void;
  punchCache: Record<string, PunchRecord[]>;
  setPunchCache: (dateKey: string, punches: PunchRecord[]) => void;
  // Schedule page cache — keyed by "from:to" date range
  myScheduleCache: Record<string, Schedule[]>;
  setMyScheduleCache: (rangeKey: string, schedules: Schedule[]) => void;
};

const AppDataContext = createContext<AppDataContextValue>({
  me: { isManager: false, employeeId: null, employeeName: null },
  storeHours: DEFAULT_STORE_HOURS,
  settings: DEFAULT_SETTINGS,
  sharedLoading: true,
  refreshMe: () => {},
  refreshStoreHours: () => {},
  refreshSettings: () => {},
  employees: [],
  refreshEmployees: () => {},
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

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();

  const [me, setMe] = useState<MeData>({ isManager: false, employeeId: null, employeeName: null });
  const [storeHours, setStoreHours] = useState<Record<number, StoreHours>>(DEFAULT_STORE_HOURS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleCache, setScheduleCacheState] = useState<Record<string, Schedule[]>>({});
  const [punchCache, setPunchCacheState] = useState<Record<string, PunchRecord[]>>({});
  const [myScheduleCache, setMyScheduleCacheState] = useState<Record<string, Schedule[]>>({});

  const applyMe = (data: { isManager?: boolean; employeeId?: number | null; employeeName?: string | null }) => {
    setMe({ isManager: !!data.isManager, employeeId: data.employeeId ?? null, employeeName: data.employeeName ?? null });
  };

  const refreshMe = useCallback(() => {
    fetch(`/api/me${isDemo ? "?demo=true" : ""}`)
      .then(r => r.json())
      .then(applyMe)
      .catch(() => {});
  }, [isDemo]);

  const refreshEmployees = useCallback(() => {
    fetch(`/api/employees?demo=${isDemo}`)
      .then(r => r.json())
      .then((data: Employee[]) => { if (Array.isArray(data)) setEmployees(data); })
      .catch(() => {});
  }, [isDemo]);

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

  useEffect(() => {
    setSharedLoading(true);
    Promise.allSettled([
      fetch(`/api/me${isDemo ? "?demo=true" : ""}`).then(r => r.json()),
      fetch("/api/store-hours").then(r => r.json()),
      fetch("/api/settings").then(r => r.json()),
      fetch(`/api/employees?demo=${isDemo}`).then(r => r.json()),
    ]).then(([meResult, hoursResult, settingsResult, empsResult]) => {
      if (meResult.status === "fulfilled") applyMe(meResult.value);
      if (hoursResult.status === "fulfilled") setStoreHours(prev => ({ ...prev, ...hoursResult.value }));
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      if (empsResult.status === "fulfilled" && Array.isArray(empsResult.value)) setEmployees(empsResult.value);
    }).finally(() => setSharedLoading(false));
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    const channel = supabase
      .channel("app-data-shared")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, refreshStoreHours)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, refreshSettings)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refreshEmployees)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isDemo, refreshStoreHours, refreshSettings, refreshEmployees]);

  return (
    <AppDataContext.Provider value={{
      me, storeHours, settings, sharedLoading,
      refreshMe, refreshStoreHours, refreshSettings,
      employees, refreshEmployees,
      scheduleCache, setScheduleCache,
      punchCache, setPunchCache,
      myScheduleCache, setMyScheduleCache,
    }}>
      {children}
    </AppDataContext.Provider>
  );
}
