"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { StoreHours } from "@/data/types";

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
};

const AppDataContext = createContext<AppDataContextValue>({
  me: { isManager: false, employeeId: null, employeeName: null },
  storeHours: DEFAULT_STORE_HOURS,
  settings: DEFAULT_SETTINGS,
  sharedLoading: true,
  refreshMe: () => {},
  refreshStoreHours: () => {},
  refreshSettings: () => {},
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

  const applyMe = (data: { isManager?: boolean; employeeId?: number | null; employeeName?: string | null }) => {
    setMe({ isManager: !!data.isManager, employeeId: data.employeeId ?? null, employeeName: data.employeeName ?? null });
  };

  const refreshMe = useCallback(() => {
    fetch(`/api/me${isDemo ? "?demo=true" : ""}`)
      .then(r => r.json())
      .then(applyMe)
      .catch(() => {});
  }, [isDemo]);

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
    Promise.all([
      fetch(`/api/me${isDemo ? "?demo=true" : ""}`).then(r => r.json()),
      fetch("/api/store-hours").then(r => r.json()),
      fetch("/api/settings").then(r => r.json()),
    ]).then(([meData, hoursData, settingsData]) => {
      applyMe(meData);
      setStoreHours(prev => ({ ...prev, ...hoursData }));
      setSettings(settingsData);
    }).catch(() => {}).finally(() => setSharedLoading(false));
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    const channel = supabase
      .channel("app-data-shared")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, refreshStoreHours)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, refreshSettings)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isDemo, refreshStoreHours, refreshSettings]);

  return (
    <AppDataContext.Provider value={{ me, storeHours, settings, sharedLoading, refreshMe, refreshStoreHours, refreshSettings }}>
      {children}
    </AppDataContext.Provider>
  );
}
