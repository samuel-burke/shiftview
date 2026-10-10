export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Inline save feedback for settings forms. Its line is always there, so the
// status coming and going after each autosave doesn't move the form.
export default function SaveStatusText({ status, testId }: { status: SaveStatus; testId: string }) {
  return (
    <div data-testid={testId} aria-live="polite" className="min-h-4 mt-2 text-xs leading-4 text-right">
      {status === "saving" && <div className="text-slate-400">Saving…</div>}
      {status === "saved"  && <div className="text-emerald-400">Saved ✓</div>}
      {status === "error"  && <div role="alert" className="text-red-400">Failed to save</div>}
    </div>
  );
}
