"use client";

import { useState } from "react";
import { validateSkillName } from "../lib/skills";

export type Skill = { id: number; name: string };

// Employee skill chips. Managers can add/remove; everyone else sees a read-only
// tag list. Presentational — the parent persists via /api/employee-skills.
export default function SkillTags({
  skills,
  canManage = false,
  onAdd,
  onDelete,
}: {
  skills: Skill[];
  canManage?: boolean;
  onAdd?: (name: string) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const check = validateSkillName(name);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setName("");
    onAdd?.(check.value);
  };

  return (
    <div data-testid="skill-tags" className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Skills</div>

      {skills.length === 0 ? (
        <div className="text-sm text-slate-500">No skills listed</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span
              key={s.id}
              data-testid={`skill-${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-card border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200"
            >
              {s.name}
              {canManage && onDelete && (
                <button
                  onClick={() => onDelete(s.id)}
                  aria-label={`Remove ${s.name}`}
                  className="text-slate-500 hover:text-red-400 cursor-pointer bg-transparent border-none p-0 leading-none"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              aria-label="New skill"
              placeholder="Add a skill…"
              className="flex-1 rounded-xl bg-card border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600"
            />
            <button
              onClick={add}
              className="rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2 text-sm font-bold text-white cursor-pointer border-none hover:brightness-110"
            >
              Add
            </button>
          </div>
          {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
}
