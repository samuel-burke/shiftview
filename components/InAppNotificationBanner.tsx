"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { playNotificationSound } from "@/lib/notification-sound";
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

function ChessPieceIcon({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 2h6M12 2v3M8 5h8l-1 5H9L8 5zM7 10h10l1 9H6l1-9zM5 19h14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type BannerItem = {
  id: number;
  title: string;
  body: string;
  type?: string;
  onTap?: () => void;
};

const TYPE_ICON_MAP: Record<string, { Icon: (p: { size?: number; color?: string }) => React.ReactElement | null; color: string }> = {
  chess_move:         { Icon: ChessPieceIcon,      color: "#f59e0b" },
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
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const showBanner = useCallback((title: string, body: string, type?: string, onTap?: () => void) => {
    const id = nextId++;
    setBanners((prev) => [...prev, { id, title, body, type, onTap }]);
    playNotificationSound();
    setTimeout(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const dismiss = useCallback((id: number) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Path 1: service worker push (mobile / browsers with Push API support)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function onMessage(e: MessageEvent) {
      // Relay OPEN_CHESS from SW — covers two cases:
      // 1. App was backgrounded and user tapped the OS notification (SW posts directly)
      // 2. App was cold-started by a notification tap (SW replies to CLIENT_READY below)
      if (e.data?.type === "OPEN_CHESS") {
        window.dispatchEvent(
          new CustomEvent("open-chess-board", {
            detail: { fromUserId: e.data.fromUserId, fromName: e.data.fromName ?? "" },
          })
        );
        return;
      }

      if (e.data?.type !== "PUSH_FOREGROUND") return;
      const { title, body, tag, data } = e.data.payload ?? {};

      // Suppress if this exact chess board is already visible.
      if (
        data?.type === "chess_move" &&
        (window as Window & { __chessOpen?: string }).__chessOpen === data.convId
      ) return;

      const onTap =
        data?.type === "chess_move" && data.fromUserId
          ? () =>
              window.dispatchEvent(
                new CustomEvent("open-chess-board", {
                  detail: { fromUserId: data.fromUserId, fromName: data.fromName ?? "" },
                })
              )
          : undefined;

      showBanner(title ?? "ShiftView", body ?? "", tag, onTap);
    }

    navigator.serviceWorker.addEventListener("message", onMessage);

    // Tell the SW we're ready. If the app was cold-started by tapping a chess
    // notification, the SW stored the intent in _pendingChess and will reply
    // with OPEN_CHESS now that our listener is registered.
    navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage({ type: "CLIENT_READY" }))
      .catch(() => {});

    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [showBanner]);

  // Path 2: chess fallback for browsers without Push API (e.g. Safari desktop).
  // Push-capable browsers handle this via the SW PUSH_FOREGROUND path (Path 1) instead.
  useEffect(() => {
    function onChessMove(e: Event) {
      if ("PushManager" in window) return; // push-capable: Path 1 handles it
      const { status, opponentName, fromUserId, convId } = (e as CustomEvent).detail ?? {};
      let title = "Your move!";
      let body = `${opponentName ?? "Opponent"} made their move`;
      if (status === "white_wins" || status === "black_wins") {
        title = "Checkmate!";
        body = `${opponentName ?? "Opponent"} won the game`;
      } else if (status === "draw") {
        title = "Draw!";
        body = "The game ended in a draw";
      }
      const onTap = fromUserId
        ? () =>
            window.dispatchEvent(
              new CustomEvent("open-chess-board", {
                detail: { fromUserId, fromName: opponentName ?? "", convId },
              })
            )
        : undefined;
      showBanner(title, body, "chess_move", onTap);
    }
    window.addEventListener("chess-move-received", onChessMove);
    return () => window.removeEventListener("chess-move-received", onChessMove);
  }, [showBanner]);

  // Path 3: Supabase Realtime (desktop browsers without Push API, e.g. Safari on macOS)
  // Fires on every INSERT into notifications for the current user, which is how the
  // server delivers notifications regardless of push subscription status.
  useEffect(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    const sb = supabaseRef.current;

    let userId: string | null = null;
    let channel: ReturnType<typeof sb.channel> | null = null;

    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      userId = user.id;

      channel = sb
        .channel(`banner:${userId}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            // Skip if push is supported — the service worker PUSH_FOREGROUND message
            // handles it there to avoid double-banners on push-capable browsers.
            if ("PushManager" in window) return;
            const row = payload.new as { title?: string; body?: string; type?: string };
            showBanner(row.title ?? "ShiftView", row.body ?? "", row.type);
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [showBanner]);

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
              onClick={banner.onTap}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className={`pointer-events-auto w-80 bg-card border border-slate-800 rounded-2xl shadow-xl flex items-start gap-3 px-4 py-3 ${banner.onTap ? "cursor-pointer hover:bg-slate-800/60 transition-colors" : ""}`}
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
                onClick={(e) => { e.stopPropagation(); dismiss(banner.id); }}
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
