"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";

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

export default function MessageThread({ open, otherUserId, otherName, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
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

    fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ withUserId: otherUserId }),
    });

    const [a, b] = [myUserId, otherUserId].sort();
    const convId = `${a}_${b}`;
    const sb = getSupabase();
    const channel = sb
      .channel(`msg_${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        () => {
          fetchMessages();
          fetch("/api/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ withUserId: otherUserId }),
          });
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

  // Clear messages when closed
  useEffect(() => {
    if (!open) {
      setBody("");
      setMessages([]);
    }
  }, [open]);

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;
    setBody("");
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: otherUserId, body: text }),
      });
      await fetchMessages();
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
            className="size-8 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-slate-700 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

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
            const isMine = msg.from_user_id === myUserId;
            const prev = messages[i - 1];
            const showTime =
              !prev ||
              new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

            // Show "Read" below the last message I sent that the other person has read
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
                {isLastReadByMe && (
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
              className="size-[42px] rounded-full bg-gradient-to-br from-blue-500 to-violet-500 border-none text-white flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-opacity hover:opacity-80"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22 11 13 2 9l20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 text-center">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </>
  );
}
