export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Inline save feedback for settings forms.
export default function SaveStatusText({ status, testId }: { status: SaveStatus; testId: string }) {
  return (
    <div data-testid={testId} aria-live="polite">
      {status === "saving" && <div className="text-xs text-slate-400 mt-2 text-right">Saving…</div>}
      {status === "saved"  && <div className="text-xs text-emerald-400 mt-2 text-right">Saved ✓</div>}
      {status === "error"  && <div role="alert" className="text-xs text-red-400 mt-2 text-right">Failed to save</div>}
    </div>
  );
}
