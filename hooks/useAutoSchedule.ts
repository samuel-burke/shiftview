"use client";

import { useEffect, useState } from "react";
import type { GenerateRequest } from "@/components/AutoScheduleSheet";
import type { SummaryBusy } from "@/components/AutoScheduleSummary";
import type { Adjustment, GenerationRun, Suggestion } from "@/lib/scheduler/types";
import { throwApiError } from "./useWeekShifts";

// The Week page's Auto-schedule state for one week (Draft mode): the latest
// run still in effect (its summary card), the setup sheet, and generate /
// another version / one-tap fix / undo. onDraftsChanged reloads the drafts.

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The week's latest Auto-schedule run that is still in effect, or null. */
async function fetchLatestRun(weekStart: string): Promise<GenerationRun | null> {
  const res = await fetch(`/api/drafts/generate?weekStart=${weekStart}`).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.run ?? null;
}

export function useAutoSchedule({
  enabled,
  weekStart,
  apiFetch,
  onDraftsChanged,
}: {
  enabled: boolean;
  weekStart: string;
  apiFetch: ApiFetch;
  onDraftsChanged: () => Promise<void>;
}) {
  // Kept with its week, so changing weeks never shows another week's run.
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [dismissedRunId, setDismissedRunId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState<SummaryBusy>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchLatestRun(weekStart).then((latest) => { if (!cancelled) setRun(latest); });
    return () => { cancelled = true; };
  }, [enabled, weekStart]);
  const currentRun = run?.weekStart === weekStart ? run : null;

  async function requestGeneration(body: Record<string, unknown>): Promise<GenerationRun> {
    const res = await apiFetch("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Couldn't generate a schedule");
    return json.run as GenerationRun;
  }

  async function generate(request: GenerateRequest) {
    setGenerating(true);
    setSheetError(null);
    try {
      const next = await requestGeneration({ ...request });
      setRun(next);
      setSummaryError(null);
      await onDraftsChanged();
      setSheetOpen(false);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Couldn't generate a schedule");
    } finally {
      setGenerating(false);
    }
  }

  // Another version of the current run, with (possibly changed) adjustments.
  async function regenerate(adjustments: Adjustment[], busy: SummaryBusy) {
    if (!currentRun) return;
    setSummaryBusy(busy);
    setSummaryError(null);
    try {
      const next = await requestGeneration({
        mode: currentRun.mode,
        rules: { overtimePolicy: currentRun.rules.overtimePolicy, pendingTimeOff: currentRun.rules.pendingTimeOff },
        adjustments,
        replaceRunId: currentRun.runId,
      });
      setRun(next);
      await onDraftsChanged();
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Couldn't generate a schedule");
    } finally {
      setSummaryBusy(null);
    }
  }

  function applySuggestion(s: Suggestion) {
    if (!currentRun) return;
    regenerate(
      [
        ...currentRun.adjustments.filter((a) => !(a.kind === "employee_hours" && a.employeeId === s.employeeId)),
        { kind: "employee_hours", employeeId: s.employeeId, minHours: null, maxHours: s.maxHours },
      ],
      "suggestion"
    );
  }

  async function undo() {
    if (!currentRun) return;
    setSummaryBusy("undo");
    setSummaryError(null);
    try {
      const res = await apiFetch("/api/drafts/generate/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: currentRun.runId }),
      });
      if (!res.ok) await throwApiError(res, "Couldn't undo");
      await onDraftsChanged();
      // An earlier run for the week may be the latest again.
      setRun(await fetchLatestRun(weekStart));
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Couldn't undo");
    } finally {
      setSummaryBusy(null);
    }
  }

  return {
    currentRun,
    // The summary card shows until the week is published, the run undone, or it's dismissed.
    showSummary: currentRun !== null && currentRun.runId !== dismissedRunId,
    dismissSummary: () => currentRun && setDismissedRunId(currentRun.runId),
    sheetOpen,
    openSheet: () => { setSheetError(null); setSheetOpen(true); },
    closeSheet: () => setSheetOpen(false),
    generating,
    sheetError,
    summaryBusy,
    summaryError,
    generate,
    tryAnother: () => currentRun && regenerate(currentRun.adjustments, "another"),
    applySuggestion,
    undo,
    // After publishing: the runs can no longer be undone or replaced.
    clearRun: () => setRun(null),
  };
}
