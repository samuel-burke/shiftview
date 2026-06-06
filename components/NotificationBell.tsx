"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";
import {
  CalendarIcon,
  AlarmIcon,
  TimeOffApprovedIcon,
  TimeOffDeniedIcon,
  WarningIcon,
  MegaphoneIcon,
  BellIcon,
} from "./ShiftIcons";
import MessageThread from "./MessageThread";

type Notification = {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  data?: { fromUserId?: string; fromName?: string; [key: string]: unknown };
};

function ChatBubbleIcon({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TYPE_ICON_MAP: Record<string, { Icon: (p: { size?: number; color?: string }) => React.ReactElement | null; color: string }> = {
  shift_change:       { Icon: CalendarIcon,        color: "#60a5fa" },
  shift_reminder:     { Icon: AlarmIcon,           color: "#fbbf24" },
  swap_approved:      { Icon: TimeOffApprovedIcon, color: "#34d399" },
  swap_denied:        { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  pto_approved:       { Icon: TimeOffApprovedIcon, color: "#34d399" },
  pto_denied:         { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  late_clock_in:      { Icon: WarningIcon,         color: "#fb923c" },
  schedule_published: { Icon: MegaphoneIcon,       color: "#a78bfa" },
  message:            { Icon: ChatBubbleIcon,      color: "#818cf8" },
};

function NotifIcon({ type }: { type: string }) {
  const entry = TYPE_ICON_MAP[type] ?? { Icon: BellIcon, color: "#94a3b8" };
  const Icon = entry.Icon;
  return <Icon size={18} color={entry.color} />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<{ userId: string; name: string; openChess?: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Lazily initialised on the client only — never called during SSR / test renders
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  // Get current user ID
  useEffect(() => {
    getSupabase().auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  const unread = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/notifications?limit=30");
    if (res.ok) {
      const data = await res.json();
      setNotifications(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, []);

  // Initial load + Supabase Realtime subscription
  useEffect(() => {
    if (!userId) return;
    fetchNotifications();

    const sb = getSupabase();
    const channel = sb
      .channel(`notifications:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => { fetchNotifications(); }
      )
      .subscribe();

    return () => { sb.removeChannel(channel); };
  }, [userId]);

  // Re-fetch when the service worker receives a push (handles foreground delivery)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onSWMessage(e: MessageEvent) {
      if (e.data?.type === "PUSH_RECEIVED") fetchNotifications();
    }
    navigator.serviceWorker.addEventListener("message", onSWMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSWMessage);
  }, [fetchNotifications]);

  // Re-fetch when app comes back to foreground (handles tapping a push banner to open the app)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") fetchNotifications();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchNotifications]);

  // Open the chess board when a banner is tapped or the SW relays an OPEN_CHESS message.
  useEffect(() => {
    function onOpenChess(e: Event) {
      const { fromUserId, fromName } = (e as CustomEvent).detail ?? {};
      if (!fromUserId) return;
      setChatTarget({ userId: fromUserId, name: fromName || "Opponent", openChess: true });
      setOpen(false);
    }
    window.addEventListener("open-chess-board", onOpenChess);
    return () => window.removeEventListener("open-chess-board", onOpenChess);
  }, []);

  // Cold-start deep link: app was launched by tapping an OS notification.
  // The SW puts #chess:<userId>:<name> in the URL hash when no window was open.
  // Using a hash keeps the server component from seeing extra query params.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#chess:")) {
      const parts = hash.slice(7).split(":");
      const fromUserId = decodeURIComponent(parts[0] ?? "");
      const fromName   = decodeURIComponent(parts[1] ?? "");
      if (fromUserId) {
        setChatTarget({ userId: fromUserId, name: fromName || "Opponent", openChess: true });
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function dismissOne(id: number) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function clearAll() {
    setNotifications([]);
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (!unreadIds.length) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unreadIds }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  if (!userId) return null;

  return (
    <>
    <div className="relative" ref={panelRef}>
      <motion.button
        onClick={() => { setOpen((v) => !v); if (!open) markAllRead(); }}
        whileHover={{ scale: 1.08, boxShadow: "0 0 12px rgba(99,102,241,0.2)" }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 450, damping: 25 }}
        className="relative size-11 flex items-center justify-center rounded-xl bg-card border border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notifications-panel"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 10-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.437L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="badge"
              aria-hidden="true"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
      {open && (
        <motion.div
          id="notifications-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Notifications"
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="absolute right-0 top-11 w-80 max-h-[480px] bg-card border border-slate-800 rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden"
          style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
            <span className="text-sm font-bold text-slate-100">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors py-1.5 px-1 -mx-1"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-slate-400 hover:text-red-400 cursor-pointer transition-colors py-1.5 px-1 -mx-1"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Notifications list */}
          <div className="overflow-y-auto flex-1">
            {loading && notifications.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div aria-hidden="true" className="spinner" />
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="text-center py-10 text-sm text-slate-500">No notifications yet</div>
            )}
            {notifications.map((n) => {
              const isMsg = n.type === "message" && !!n.data?.fromUserId;
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-slate-800/50 flex gap-3 ${n.read ? "opacity-60" : ""}`}
                >
                  <span className="shrink-0 flex items-center pt-0.5"><NotifIcon type={n.type} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{n.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.body}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
                      {isMsg && (
                        <button
                          onClick={() => {
                            setChatTarget({ userId: n.data!.fromUserId as string, name: n.data!.fromName as string || n.title });
                            setOpen(false);
                          }}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium flex items-center gap-0.5 transition-colors py-2 -my-2 pr-1"
                        >
                          Reply
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    {!n.read && (
                      <span aria-hidden="true" className="size-2 rounded-full bg-indigo-500" />
                    )}
                    <button
                      onClick={() => dismissOne(n.id)}
                      aria-label={`Dismiss: ${n.title}`}
                      className="text-slate-400 hover:text-slate-200 cursor-pointer leading-none flex items-center justify-center size-8 rounded transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>

    {createPortal(
      <MessageThread
        open={!!chatTarget}
        otherUserId={chatTarget?.userId ?? ""}
        otherName={chatTarget?.name ?? ""}
        onClose={() => setChatTarget(null)}
        openChess={chatTarget?.openChess}
      />,
      document.body
    )}
    </>
  );
}
