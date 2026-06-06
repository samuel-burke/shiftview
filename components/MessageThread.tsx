"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase-browser";
import { parseChessMessage, type ChessMessage } from "./ChessBoard";

const ChessBoard = dynamic(() => import("./ChessBoard"), { ssr: false });

type Message = {
  id: number;
  from_user_id: string;
  body: string;
  read: boolean;
  created_at: string;
};

type Props = {
  open: boolean;
  otherUserId: string;
  otherName: string;
  onClose: () => void;
  openChess?: boolean;
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function chessResultLabel(game: ChessMessage, myUserId: string, otherName: string): string {
  if (game.status === "white_wins") return game.white === myUserId ? "You won" : `${otherName} won`;
  if (game.status === "black_wins") return game.black === myUserId ? "You won" : `${otherName} won`;
  if (game.status === "draw") return "Draw";
  // active game — show whose turn it is
  const myTurn = (game.status === "active") &&
    ((game.white === myUserId) === (game.fen.includes(" w ")));
  return myTurn ? "Your move" : `${otherName}'s move`;
}

export default function MessageThread({ open, otherUserId, otherName, onClose, openChess }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [chessOpen, setChessOpen] = useState(false);
  const chessOpenRef = useRef(false);
  // When the thread was opened solely to show chess (via notification tap), closing
  // the chess overlay should also close the whole thread — no need to strand the user
  // in a bare message view they never explicitly opened.
  const openedViaChessRef = useRef(false);
  // Keep ref in sync so Realtime callbacks can read the current value without stale closure
  useEffect(() => { chessOpenRef.current = chessOpen; }, [chessOpen]);

  // Stable per-instance ID used to detect other simultaneously-open threads.
  const instanceId = useRef(`mt_${Math.random().toString(36).slice(2)}`);

  // Enforce a single open chat window at a time. When this instance opens,
  // broadcast to all others so they can close. If a different instance opens
  // while we're open, close ourselves.
  useEffect(() => {
    if (!open) return;
    const id = instanceId.current;
    window.dispatchEvent(new CustomEvent("chat-opened", { detail: { id } }));
    function onOtherOpen(e: Event) {
      if ((e as CustomEvent).detail?.id !== id) onClose();
    }
    window.addEventListener("chat-opened", onOtherOpen);
    return () => window.removeEventListener("chat-opened", onOtherOpen);
  }, [open, onClose]);

  // Derived — null until myUserId resolves (async auth)
  const convId = myUserId ? [myUserId, otherUserId].sort().join("_") : null;

  // Open chess board when the parent requests it (e.g. deep-link from notification)
  useEffect(() => {
    if (open && openChess) {
      openedViaChessRef.current = true;
      setChessOpen(true);
    }
    if (!open) openedViaChessRef.current = false;
  }, [open, openChess]);

  // Advertise whether this chess board is currently visible so InAppNotificationBanner
  // can suppress push banners when the user is already watching the game.
  useEffect(() => {
    if (!convId) return;
    const w = window as Window & { __chessOpen?: string };
    if (chessOpen) {
      w.__chessOpen = convId;
    } else if (w.__chessOpen === convId) {
      w.__chessOpen = undefined;
    }
    return () => {
      if (w.__chessOpen === convId) w.__chessOpen = undefined;
    };
  }, [chessOpen, convId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  useEffect(() => {
    getSupabase()
      .auth.getUser()
      .then(({ data: { user } }) => setMyUserId(user?.id ?? null));
  }, []);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/messages?with=${encodeURIComponent(otherUserId)}&limit=50`);
    if (res.ok) {
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    }
  }, [otherUserId]);

  // Load + subscribe when drawer opens
  useEffect(() => {
    if (!open || !otherUserId || !myUserId) return;

    setLoading(true);
    fetchMessages().finally(() => setLoading(false));
    // Track message IDs we've already dispatched chess-move-received for,
    // so StrictMode double-invocation or overlapping subscriptions don't
    // fire the event (and show a banner) twice for the same message.
    const dispatchedIds = new Set<unknown>();

    fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ withUserId: otherUserId }),
    });

    const [a, b] = [myUserId, otherUserId].sort();
    const convId = `${a}_${b}`;
    const sb = getSupabase();
    const channel = sb
      .channel(`msg_${convId}_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          fetchMessages();
          fetch("/api/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ withUserId: otherUserId }),
          });
          // For browsers without Push API (e.g. Safari desktop), dispatch a local
          // event so InAppNotificationBanner can show a banner as a fallback.
          // Push-capable browsers handle this via the SW PUSH_FOREGROUND path instead.
          const row = payload.new as { id?: unknown; from_user_id?: string; body?: string };
          if (row.from_user_id && row.from_user_id !== myUserId && !chessOpenRef.current) {
            try {
              const parsed = JSON.parse(row.body ?? "");
              if (parsed._chess === true) {
                if (row.id !== undefined && dispatchedIds.has(row.id)) return;
                if (row.id !== undefined) dispatchedIds.add(row.id);
                const localConvId = [myUserId, otherUserId].sort().join("_");
                window.dispatchEvent(
                  new CustomEvent("chess-move-received", {
                    detail: {
                      status: parsed.status,
                      opponentName: otherName,
                      fromUserId: otherUserId,
                      convId: localConvId,
                    },
                  })
                );
              }
            } catch {}
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        () => { fetchMessages(); }
      )
      .subscribe();

    return () => { sb.removeChannel(channel); };
  }, [open, otherUserId, myUserId, fetchMessages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (open && messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages, open]);

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  // Clear state when closed
  useEffect(() => {
    if (!open) {
      setBody("");
      setMessages([]);
      setChessOpen(false);
    }
  }, [open]);

  async function sendMessage(text: string) {
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: otherUserId, body: text }),
    });
    await fetchMessages();
  }

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;

    if (text === "/chess") {
      setBody("");
      if (latestChessGame?.status === "active") {
        setChessOpen(true);
      } else {
        startChessGame();
      }
      return;
    }

    setBody("");
    setSending(true);
    try {
      await sendMessage(text);
    } finally {
      setSending(false);
    }
  }

  async function startChessGame() {
    if (!myUserId) return;
    const iAmWhite = Math.random() < 0.5;
    const gameMsg = JSON.stringify({
      _chess: true,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      white: iAmWhite ? myUserId : otherUserId,
      black: iAmWhite ? otherUserId : myUserId,
      status: "active",
    });
    setSending(true);
    try {
      await sendMessage(gameMsg);
      setChessOpen(true);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // Escape key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Find the last chess message — used for board state and the single status pill
  let latestChessGame: ChessMessage | null = null;
  let latestChessIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parseChessMessage(messages[i].body);
    if (parsed) { latestChessGame = parsed; latestChessIndex = i; break; }
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-black/60 z-[60] transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Message thread with ${otherName}`}
        className={`fixed inset-y-0 right-0 z-[70] w-full max-w-[420px] bg-slate-900 border-l border-slate-800 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 border-b border-slate-800 shrink-0"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)", paddingBottom: 16 }}
        >
          <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {initials(otherName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{otherName}</div>
            <div className="text-[11px] text-slate-500">Direct message</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-10 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-slate-700 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Chess full-screen overlay — opened on top of everything for a larger board */}
        {chessOpen && myUserId && latestChessGame && (
          <div
            className="fixed inset-0 z-[80] bg-slate-950 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Chess board"
          >
            <div
              className="flex items-center gap-3 px-5 border-b border-slate-800 shrink-0"
              style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: 14 }}
            >
              <div className="text-sm font-bold text-slate-100">Chess</div>
              <div className="text-sm text-slate-500">vs {otherName}</div>
              <button
                onClick={() => { setChessOpen(false); if (openedViaChessRef.current) onClose(); }}
                aria-label="Close chess board"
                className="ml-auto size-9 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center overflow-y-auto">
              <div className="w-full max-w-[600px] sm:px-4 py-3">
                <ChessBoard
                  myUserId={myUserId}
                  otherName={otherName}
                  game={latestChessGame}
                  onSend={sendMessage}
                />
                {latestChessGame.status !== "active" && (
                  <button
                    onClick={() => { setChessOpen(false); startChessGame(); }}
                    disabled={sending}
                    className="mt-4 w-full py-2.5 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
                  >
                    New game
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Messages list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1">
          {loading && (
            <div role="status" aria-label="Loading messages" className="text-center text-sm text-slate-500 mt-8">Loading…</div>
          )}
          {!loading && messages.length === 0 && (
            <div className="text-center text-sm text-slate-500 mt-8">
              No messages yet. Say hi!
            </div>
          )}
          {messages.map((msg, i) => {
            const isChess = !!parseChessMessage(msg.body);

            // Skip all chess messages except the last one (which becomes the status pill)
            if (isChess && i !== latestChessIndex) return null;

            const isMine = msg.from_user_id === myUserId;
            const prev = messages[i - 1];
            const showTime =
              !prev ||
              new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

            const isLastReadByMe =
              isMine &&
              msg.read &&
              messages.slice(i + 1).every((m) => !(m.from_user_id === myUserId && m.read));

            return (
              <div key={msg.id}>
                {showTime && (
                  <div className="text-center text-[11px] text-slate-500 my-2">
                    {timeLabel(msg.created_at)}
                  </div>
                )}

                {isChess && latestChessGame ? (
                  <div className="flex justify-center my-1">
                    <button
                      onClick={() => setChessOpen(true)}
                      className="text-[11px] text-slate-500 bg-slate-800/60 rounded-full px-3 py-1 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
                    >
                      ♟ {myUserId ? chessResultLabel(latestChessGame, myUserId, otherName) : "Chess"}
                    </button>
                  </div>
                ) : (
                  <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    {!isMine && (
                      <div aria-hidden="true" className="size-6 rounded-full bg-indigo-600/50 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mr-1.5 mt-auto mb-0.5">
                        {initials(otherName)}
                      </div>
                    )}
                    <div
                      className={`max-w-[72%] px-3.5 py-2 text-sm leading-relaxed break-words ${
                        isMine
                          ? "bg-gradient-to-br from-blue-500 to-violet-500 text-white rounded-2xl rounded-br-[6px]"
                          : "bg-slate-800 text-slate-100 rounded-2xl rounded-bl-[6px]"
                      }`}
                    >
                      {msg.body}
                    </div>
                  </div>
                )}

                {isLastReadByMe && !isChess && (
                  <div className="text-right text-[10px] text-slate-400 pr-1 mt-0.5">Read</div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          className="px-4 border-t border-slate-800 shrink-0"
          style={{ paddingTop: 12, paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={autoResize}
              placeholder={`Message ${otherName}…`}
              aria-label={`Message to ${otherName}`}
              rows={1}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-[10px] text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-indigo-500/70 transition-colors"
              style={{ maxHeight: 120 }}
            />
            <button
              onClick={handleSend}
              disabled={!body.trim() || sending}
              aria-label="Send message"
              aria-busy={sending}
              className="size-11 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 border-none text-white flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-opacity hover:opacity-80"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22 11 13 2 9l20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 text-center">
            Enter to send · Shift+Enter for new line · /chess to play
          </div>
        </div>
      </div>
    </>
  );
}
