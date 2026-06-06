"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { playNotificationSound } from "@/lib/notification-sound";
import {
  CalendarIcon,
  AlarmIcon,
  TimeOffApprovedIcon,
  TimeOffDeniedIcon,
  WarningIcon,
  MegaphoneIcon,
  BellIcon,
} from "./ShiftIcons";

type BannerItem = {
  id: number;
  title: string;
  body: string;
  type?: string;
};

const TYPE_ICON_MAP: Record<string, { Icon: (p: { size?: number; color?: string }) => React.ReactElement | null; color: string }> = {
  shift_change:       { Icon: CalendarIcon,        color: "#60a5fa" },
  shift_reminder:     { Icon: AlarmIcon,           color: "#fbbf24" },
  swap_approved:      { Icon: TimeOffApprovedIcon, color: "#34d399" },
  swap_denied:        { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  pto_approved:       { Icon: TimeOffApprovedIcon, color: "#34d399" },
  pto_denied:         { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  late_clock_in:      { Icon: WarningIcon,         color: "#fb923c" },
  schedule_published: { Icon: MegaphoneIcon,       color: "#a78bfa" },
};

const AUTO_DISMISS_MS = 5000;
let nextId = 1;

export default function InAppNotificationBanner() {
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const dismiss = useCallback((id: number) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function onMessage(e: MessageEvent) {
      if (e.data?.type !== "PUSH_FOREGROUND") return;
      const { title, body, tag } = e.data.payload ?? {};
      const id = nextId++;
      setBanners((prev) => [...prev, { id, title: title ?? "ShiftView", body: body ?? "", type: tag }]);
      playNotificationSound();
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    }

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [dismiss]);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {banners.map((banner) => {
          const entry = banner.type ? (TYPE_ICON_MAP[banner.type] ?? null) : null;
          const Icon = entry?.Icon ?? BellIcon;
          const color = entry?.color ?? "#94a3b8";
          return (
            <motion.div
              key={banner.id}
              role="status"
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="pointer-events-auto w-80 bg-card border border-slate-800 rounded-2xl shadow-xl flex items-start gap-3 px-4 py-3"
              style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)" }}
            >
              <span className="shrink-0 mt-0.5">
                <Icon size={18} color={color} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-100 truncate">{banner.title}</div>
                {banner.body && (
                  <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{banner.body}</div>
                )}
              </div>
              <button
                onClick={() => dismiss(banner.id)}
                aria-label="Dismiss notification"
                className="shrink-0 text-slate-500 hover:text-slate-300 cursor-pointer flex items-center justify-center size-6 rounded transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
