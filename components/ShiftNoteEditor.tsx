"use client";

import { useState } from "react";
import { validateShiftNote, SHIFT_NOTE_MAX } from "../lib/shift-note";

// Edit a single shift's note. Presentational — the parent persists via
// PUT /api/schedules/note. For read-only viewers, pass canEdit={false}.
export default function ShiftNoteEditor({
  note,
  canEdit = false,
  onSave,
}: {
  note: string | null;
  canEdit?: boolean;
  onSave?: (note: string | null) => Promise<void> | void;
}) {
  const [value, setValue] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return note ? (
      <div data-testid="shift-note-readonly" className="text-xs text-slate-300 italic">
        {note}
      </div>
    ) : null;
  }

  const save = () => {
    const check = validateShiftNote(value);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    onSave?.(check.value);
  };

  return (
    <div data-testid="shift-note-editor" className="flex flex-col gap-1.5">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={SHIFT_NOTE_MAX}
        placeholder="Add a note (e.g. Training, Lock up)"
        aria-label="Shift note"
        rows={2}
        className="rounded-xl bg-card border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600 resize-none"
      />
      {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">{value.length}/{SHIFT_NOTE_MAX}</span>
        <button
          onClick={save}
          className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer border-none hover:brightness-110 transition-[filter]"
        >
          Save note
        </button>
      </div>
    </div>
  );
}
