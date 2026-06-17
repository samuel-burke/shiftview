"use client";

import { useState } from "react";
import { validateShiftLogEntry, SHIFT_LOG_MAX } from "../lib/shift-log";

// Shift handoff log for a day: any staff member can post; the author or a
// manager can remove. Presentational — the parent persists via /api/shift-log.

export type ShiftLogEntry = {
  id: number;
  employeeId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ShiftLogFeed({
  entries,
  currentEmployeeId = null,
  isManager = false,
  onPost,
  onDelete,
}: {
  entries: ShiftLogEntry[];
  currentEmployeeId?: number | null;
  isManager?: boolean;
  onPost: (body: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const post = () => {
    const check = validateShiftLogEntry(text);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setText("");
    onPost(check.value);
  };

  const canDelete = (e: ShiftLogEntry) => isManager || e.employeeId === currentEmployeeId;

  return (
    <div data-testid="shift-log-feed" className="flex flex-col gap-3">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Shift Log</div>

      <div className="flex flex-col gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={SHIFT_LOG_MAX}
          rows={2}
          aria-label="Shift log entry"
          placeholder="Leave a note for the next shift…"
          className="rounded-xl bg-card border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600 resize-none"
        />
        {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
        <div className="flex justify-end">
          <button
            onClick={post}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer border-none hover:brightness-110 transition-[filter]"
          >
            Post
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-4 text-slate-400 text-sm">No entries yet today</div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div
              key={e.id}
              data-testid={`shift-log-entry-${e.id}`}
              className="rounded-xl bg-card border border-slate-800/60 px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">{e.authorName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">{formatTime(e.createdAt)}</span>
                  {canDelete(e) && onDelete && (
                    <button
                      onClick={() => onDelete(e.id)}
                      aria-label={`Delete entry by ${e.authorName}`}
                      className="text-[10px] font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm text-slate-300 mt-0.5 whitespace-pre-wrap">{e.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
