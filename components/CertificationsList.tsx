"use client";

// Read-only list of an employee's certifications with expiry status. The parent
// fetches /api/certifications (which annotates each row with a status) and may
// pass a delete handler for managers.

import type { CertStatus } from "../lib/certifications";

export type Certification = {
  id: number;
  name: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  status: CertStatus;
};

const STATUS_META: Record<CertStatus, { label: string; cls: string }> = {
  valid:     { label: "Valid",    cls: "text-emerald-300 bg-emerald-500/15" },
  expiring:  { label: "Expiring", cls: "text-amber-300 bg-amber-500/20" },
  expired:   { label: "Expired",  cls: "text-red-300 bg-red-500/20" },
  no_expiry: { label: "No expiry", cls: "text-slate-300 bg-slate-700/40" },
};

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function CertificationsList({
  certifications,
  canManage = false,
  onDelete,
}: {
  certifications: Certification[];
  canManage?: boolean;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  return (
    <div data-testid="certifications-list" className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Certifications</div>

      {certifications.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No certifications on file</div>
      ) : (
        certifications.map((c) => {
          const meta = STATUS_META[c.status];
          return (
            <div
              key={c.id}
              data-testid={`certification-${c.id}`}
              className="flex items-center justify-between rounded-xl bg-card border border-slate-800/60 px-3 py-2.5"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-100">{c.name}</span>
                {c.expiresOn && (
                  <span className="text-[11px] text-slate-500">Expires {formatDate(c.expiresOn)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${meta.cls}`}>
                  {meta.label}
                </span>
                {canManage && onDelete && (
                  <button
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete ${c.name}`}
                    className="text-[11px] font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
