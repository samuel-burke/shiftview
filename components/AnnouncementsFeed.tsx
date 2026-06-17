"use client";

// Team announcements board. Presentational — the parent fetches
// /api/announcements and (for managers) wires up posting/removal.

export type Announcement = {
  id: number;
  title: string;
  body: string;
  createdAt: string;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function AnnouncementsFeed({
  announcements,
  canManage = false,
  onDelete,
}: {
  announcements: Announcement[];
  canManage?: boolean;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  return (
    <div data-testid="announcements-feed" className="flex flex-col gap-3">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Announcements</div>

      {announcements.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No announcements</div>
      ) : (
        announcements.map((a) => (
          <div
            key={a.id}
            data-testid={`announcement-${a.id}`}
            className="rounded-2xl bg-card border border-slate-800/60 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-bold text-slate-100">{a.title}</div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-500">{formatWhen(a.createdAt)}</span>
                {canManage && onDelete && (
                  <button
                    onClick={() => onDelete(a.id)}
                    aria-label={`Delete announcement ${a.title}`}
                    className="text-[11px] font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">{a.body}</div>
          </div>
        ))
      )}
    </div>
  );
}
