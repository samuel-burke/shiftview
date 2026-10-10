export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Save feedback for settings forms. It sits in a line that already has its
// height (a section's label row, or beside a Save button), so the status
// coming and going after each save neither moves the form nor needs a line
// of its own.
export default function SaveStatusText({ status, testId }: { status: SaveStatus; testId: string }) {
  return (
    <div data-testid={testId} aria-live="polite" className="text-xs leading-4">
      {status === "saving" && <div className="text-slate-400">Saving…</div>}
      {status === "saved"  && <div className="text-emerald-400">Saved ✓</div>}
      {status === "error"  && <div role="alert" className="text-red-400">Failed to save</div>}
    </div>
  );
}
