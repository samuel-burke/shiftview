"use client";

import { useState } from "react";
import { validateEmployeeNote } from "../lib/employee-note";

export type EmployeeNote = {
  id: number;
  body: string;
  authorName: string;
  createdAt: string;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

// Manager-only private notes about an employee. Presentational — the parent
// fetches /api/employee-notes (a manager-gated route). Not rendered for
// non-managers.
export default function EmployeeNotes({
  notes,
  onAdd,
  onDelete,
}: {
  notes: EmployeeNote[];
  onAdd: (body: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const check = validateEmployeeNote(text);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setText("");
    onAdd(check.value);
  };

  return (
    <div data-testid="employee-notes" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Manager Notes</span>
        <span className="text-[10px] text-slate-500" aria-hidden="true">🔒 private</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="New manager note"
          placeholder="Add a private note (not visible to the employee)…"
          className="rounded-xl bg-card border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600 resize-none"
        />
        {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
        <div className="flex justify-end">
          <button
            onClick={add}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer border-none hover:brightness-110"
          >
            Save note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-4 text-slate-400 text-sm">No notes yet</div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} data-testid={`employee-note-${n.id}`} className="rounded-xl bg-card border border-slate-800/60 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{n.authorName} · {formatWhen(n.createdAt)}</span>
                {onDelete && (
                  <button
                    onClick={() => onDelete(n.id)}
                    aria-label={`Delete note ${n.id}`}
                    className="text-[10px] font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="text-sm text-slate-200 mt-0.5 whitespace-pre-wrap">{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
