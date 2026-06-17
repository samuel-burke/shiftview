"use client";

import { useState } from "react";
import { validatePositionName } from "../lib/positions";

export type Position = { id: number; name: string; color?: string | null };

// Manager UI to create and remove positions. Presentational — the parent owns
// the list and persists via /api/positions.
export default function PositionsManager({
  positions,
  onCreate,
  onDelete,
}: {
  positions: Position[];
  onCreate: (name: string) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const check = validatePositionName(name);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setName("");
    onCreate(check.value);
  };

  return (
    <div data-testid="positions-manager" className="flex flex-col gap-3">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Positions</div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add a position (e.g. Cashier)"
          aria-label="Position name"
          className="flex-1 rounded-xl bg-card border border-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600"
        />
        <button
          onClick={submit}
          className="rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2.5 text-sm font-bold text-white cursor-pointer border-none hover:brightness-110 transition-[filter]"
        >
          Add
        </button>
      </div>
      {error && <div role="alert" className="text-xs text-red-400">{error}</div>}

      {positions.length === 0 ? (
        <div className="text-center py-4 text-slate-400 text-sm">No positions yet</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {positions.map((p) => (
            <div
              key={p.id}
              data-testid={`position-row-${p.id}`}
              className="flex items-center justify-between rounded-xl bg-card border border-slate-800/60 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ background: p.color ?? "var(--color-shift-mid)" }}
                />
                {p.name}
              </span>
              <button
                onClick={() => onDelete(p.id)}
                aria-label={`Delete ${p.name}`}
                className="text-xs font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
