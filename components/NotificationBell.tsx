"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
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
  ChatBubbleIcon,
  ChessPieceIcon,
} from "./ShiftIcons";

type Notification = {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  data?: { fromUserId?: string; fromName?: string; [key: string]: unknown };
};

const TYPE_ICON_MAP: Record<string, { Icon: (p: { size?: number; color?: string }) => React.ReactElement | null; color: string }> = {
  shift_change:       { Icon: CalendarIcon,        color: "#60a5fa" },
  shift_reminder:     { Icon: AlarmIcon,           color: "#fbbf24" },
  swap_approved:      { Icon: TimeOffApprovedIcon, color: "#34d399" },
  swap_denied:        { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  pto_approved:       { Icon: TimeOffApprovedIcon, color: "#34d399" },
  pto_denied:         { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  late_clock_in:      { Icon: WarningIcon,         color: "#fb923c" },
  punch_correction_requested: { Icon: WarningIcon,         color: "#fbbf24" },
  punch_correction_approved:  { Icon: TimeOffApprovedIcon, color: "#34d399" },
  punch_correction_denied:    { Icon: TimeOffDeniedIcon,   color: "#f87171" },
  schedule_published: { Icon: MegaphoneIcon,       color: "#a78bfa" },
  message:            { Icon: ChatBubbleIcon,      color: "#818cf8" },
  chess_move:         { Icon: ChessPieceIcon,      color: "#f59e0b" },
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

// Every mounted bell shares one store. The bell sits in per-page headers (and
// a page can render two — the phone top bar and the desk header, one hidden by
// CSS), so per-instance state meant a session lookup, a notifications fetch
// and a Realtime channel per bell, repeated on every navigation. The store
// keeps one of each for as long as any bell is mounted, and briefly after the
// last unmounts so a page navigation reuses them instead of reconnecting.
type BellState = { userId: string | null; notifications: Notification[]; loading: boolean };

let bellState: BellState = { userId: null, notifications: [], loading: false };
const bellListeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let mountedBells = 0;
let stopLive: (() => void) | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
// How long the channel outlives the last bell (covers a page navigation).
const KEEPALIVE_MS = 10_000;

function setBellState(patch: Partial<BellState>) {
  bellState = { ...bellState, ...patch };
  bellListeners.forEach((l) => l());
}

function subscribeBell(listener: () => void) {
  bellListeners.add(listener);
  return () => { bellListeners.delete(listener); };
}

const getBellState = () => bellState;

// Concurrent callers (realtime insert, push relay, tab refocus) share one request.
function fetchNotifications(): Promise<void> {
  if (inflight) return inflight;
  setBellState({ loading: true });
  inflight = fetch("/api/notifications?limit=30")
    .then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      setBellState({ notifications: Array.isArray(data) ? data : [] });
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
      setBellState({ loading: false });
    });
  return inflight;
}

function updateNotifications(fn: (prev: Notification[]) => Notification[]) {
  setBellState({ notifications: fn(bellState.notifications) });
}

function startLive(): () => void {
  let cancelled = false;
  let teardownChannel: (() => void) | null = null;
  const sb = createClient();

  // Only the user id is needed (to show the bell and name the channel), so
  // the locally stored session will do — getUser() would add a round trip to
  // Supabase Auth before anything loads. The API and RLS verify the caller.
  sb.auth.getSession().then(({ data: { session } }) => {
    if (cancelled) return;
    const id = session?.user.id ?? null;
    if (id !== bellState.userId) setBellState({ userId: id, notifications: [] });
    if (!id) return;
    fetchNotifications();
    const channel = sb
      .channel(`notifications:${id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        // No user_id filter: RLS scopes the stream to the user's own rows plus
        // broadcast rows (user_id null) when they're a manager — a filter on
        // user_id would drop the broadcasts.
        { event: "INSERT", schema: "public", table: "notifications" },
        () => { fetchNotifications(); }
      )
      .subscribe();
    teardownChannel = () => { sb.removeChannel(channel); };
  });

  // Re-fetch when the service worker receives a push (foreground delivery)
  // and when the app comes back to the foreground (e.g. a push banner tap).
  const onSWMessage = (e: MessageEvent) => {
    if (e.data?.type === "PUSH_RECEIVED" && bellState.userId) fetchNotifications();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && bellState.userId) fetchNotifications();
  };
  const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  sw?.addEventListener("message", onSWMessage);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    cancelled = true;
    teardownChannel?.();
    sw?.removeEventListener("message", onSWMessage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function retainLive(): () => void {
  mountedBells++;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (!stopLive) stopLive = startLive();
  return () => {
    mountedBells--;
    if (mountedBells > 0) return;
    stopTimer = setTimeout(() => {
      stopTimer = null;
      stopLive?.();
      stopLive = null;
    }, KEEPALIVE_MS);
  };
}

// The thread only mounts once a conversation is opened from the bell.
const MessageThread = dynamic(() => import("./MessageThread"), { ssr: false });

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { userId, notifications, loading } = useSyncExternalStore(subscribeBell, getBellState, getBellState);
  const [chatTarget, setChatTarget] = useState<{ userId: string; name: string; openChess?: boolean } | null>(null);
  const [chatMounted, setChatMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => retainLive(), []);

  // Mount the thread on first open and keep it mounted so it can animate out.
  function openChat(target: { userId: string; name: string; openChess?: boolean }) {
    setChatTarget(target);
    setChatMounted(true);
  }

  const unread = notifications.filter((n) => !n.read).length;

  // Open the chess board when a banner is tapped or the SW relays an OPEN_CHESS message.
  useEffect(() => {
    function onOpenChess(e: Event) {
      const { fromUserId, fromName } = (e as CustomEvent).detail ?? {};
      if (!fromUserId) return;
      setChatTarget({ userId: fromUserId, name: fromName || "Opponent", openChess: true });
      setChatMounted(true);
      setOpen(false);
    }
    window.addEventListener("open-chess-board", onOpenChess);
    return () => window.removeEventListener("open-chess-board", onOpenChess);
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
    updateNotifications((prev) => prev.filter((n) => n.id !== id));
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function clearAll() {
    updateNotifications(() => []);
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
    updateNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
              // Rows shaped like notifications (icon, title, two-line body,
              // time) rather than a spinner, so the list fills in place.
              <div role="status" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} aria-hidden="true" className="px-4 py-3 border-b border-slate-800/50 flex gap-3">
                    <span className="shrink-0 pt-0.5"><span className="skeleton block size-4 rounded" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="h-5 flex items-center"><div className="skeleton h-3.5 w-1/2 rounded" /></div>
                      <div className="mt-0.5 h-8 flex flex-col justify-center gap-1.5">
                        <div className="skeleton h-2.5 w-full rounded" />
                        <div className="skeleton h-2.5 w-3/4 rounded" />
                      </div>
                      <div className="mt-1 h-4 flex items-center"><div className="skeleton h-2.5 w-12 rounded" /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="text-center py-10 text-sm text-slate-500">No notifications yet</div>
            )}
            {notifications.map((n) => {
              const isMsg = n.type === "message" && !!n.data?.fromUserId;
              const isChess = n.type === "chess_move" && !!n.data?.fromUserId;
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
                      {(isMsg || isChess) && (
                        <button
                          onClick={() => {
                            openChat({
                              userId: n.data!.fromUserId as string,
                              name: (n.data!.fromName as string) || (isChess ? "Opponent" : n.title),
                              openChess: isChess,
                            });
                            setOpen(false);
                          }}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium flex items-center gap-0.5 transition-colors py-2 -my-2 pr-1"
                        >
                          {isChess ? "Open game" : "Reply"}
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

    {chatMounted && createPortal(
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
