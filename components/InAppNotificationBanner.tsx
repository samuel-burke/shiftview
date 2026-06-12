"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { playNotificationSound, primeNotificationSound } from "@/lib/notification-sound";
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
  message:            { Icon: ChatBubbleIcon,      color: "#818cf8" },
};

const AUTO_DISMISS_MS = 5000;
// Show at most this many banners at once; the rest queue behind a "+N more"
// pill and surface as the visible ones auto-dismiss.
const MAX_VISIBLE_BANNERS = 3;
let nextId = 1;

async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export default function InAppNotificationBanner() {
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Warm up the audio context on the first user gesture so the first banner's
  // sound isn't muted by the browser's autoplay policy.
  useEffect(() => primeNotificationSound(), []);

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

  // Path 1: service worker push relay. The SW only forwards PUSH_FOREGROUND
  // for chess moves — every other notification type banners via the Realtime
  // subscription below (Path 3), which works whether or not push is set up.
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

      // Prefer data.type for the icon — chess pushes tag per-conversation
      // ("chess:<convId>"), which would miss the icon map.
      showBanner(title ?? "ShiftView", body ?? "", (data?.type as string | undefined) ?? tag, onTap);
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

  // Path 2: chess fallback for users without an active push subscription
  // (push unsupported, permission denied, or simply never enabled). Users with
  // a subscription get chess banners via the SW PUSH_FOREGROUND path (Path 1).
  useEffect(() => {
    function onChessMove(e: Event) {
      const { status, opponentName, fromUserId, convId } = (e as CustomEvent).detail ?? {};
      hasPushSubscription().then((subscribed) => {
        if (subscribed) return; // Path 1 handles it
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
      });
    }
    window.addEventListener("chess-move-received", onChessMove);
    return () => window.removeEventListener("chess-move-received", onChessMove);
  }, [showBanner]);

  // Path 3: Supabase Realtime on the notifications table — the universal
  // banner source for every signed-in user, regardless of push subscription
  // state (and including the demo org, which never pushes). No double-banner
  // risk: the SW only relays foreground payloads for chess moves, which have
  // no notifications row.
  useEffect(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    const sb = supabaseRef.current;

    let channel: ReturnType<typeof sb.channel> | null = null;

    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      channel = sb
        .channel(`banner:${user.id}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          // No user_id filter: RLS scopes the stream to the user's own rows
          // plus broadcast rows (user_id null) when they're a manager — a
          // filter on user_id would drop the broadcasts.
          { event: "INSERT", schema: "public", table: "notifications" },
          (payload) => {
            const row = payload.new as { user_id?: string | null; title?: string; body?: string; type?: string };
            // Belt-and-braces: RLS already restricts what we receive.
            if (row.user_id != null && row.user_id !== user.id) return;
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

  const visibleBanners = banners.slice(0, MAX_VISIBLE_BANNERS);
  const overflowCount = banners.length - visibleBanners.length;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {visibleBanners.map((banner) => {
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
      {overflowCount > 0 && (
        <div className="pointer-events-none self-end bg-card border border-slate-800 rounded-full px-3 py-1 text-xs text-slate-400 shadow-xl">
          +{overflowCount} more
        </div>
      )}
    </div>,
    document.body
  );
}
