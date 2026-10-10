"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Toast, ToastStack } from "@/components/Toast";
import AppShell from "../../components/AppShell";
import BottomNav from "../../components/BottomNav";
import EmployeeDrawer from "../../components/EmployeeDrawer";
import WeekGrid, { type PendingTimeOff } from "../../components/WeekGrid";
import AutoScheduleSheet, { type PlannerEmployee } from "../../components/AutoScheduleSheet";
import AutoScheduleSummary from "../../components/AutoScheduleSummary";
import WeekHeader, { Sparkle } from "../../components/week/WeekHeader";
import WeekInsights, { WeekStats } from "../../components/week/WeekInsights";
import { DayChips, DayList, DayToolbar } from "../../components/week/DayPanel";
import PublishDialog from "../../components/week/PublishDialog";
import { useAppData } from "@/lib/AppDataContext";
import { createApiFetch } from "@/lib/api-fetch";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import { throwApiError, useWeekShifts } from "@/hooks/useWeekShifts";
import { useAutoSchedule } from "@/hooks/useAutoSchedule";
import { addDaysToKey, dayOfWeekForKey, formatDateKey, nowMinutesInTz, weekStartForKey } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { curveForDate, type CoverageBlock, type CoverageDefaults, type CoverageOverrides, type CoverageProfile } from "@/lib/coverage";
import type { EmploymentType } from "@/lib/scheduling-rules";
import { cellKey, clashingDrafts, projectedShifts, weekCells, type SourcedShift } from "@/lib/week-cells";
import { parseWeekParams, weekHref, type WeekMode } from "@/lib/week-params";
import { fmtMinutes, formatDisplayName } from "@/data/types";

// The Week page: the team's week, in one of two modes (kept in the URL).
// Live shows and edits the published schedule. Draft shows the week as it will
// be after publishing (live shifts, read-only, plus drafts) and edits drafts,
// with Auto-schedule and Publish. The coverage tools follow the mode.

type PublishResult = { weekStart: string; published: number; skipped: { employeeId: number; date: string }[] };

/** True when a key press is meant for a control rather than the page. */
function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "radio";
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export default function WeekPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiFetch = useMemo(() => createApiFetch(() => router.push("/login")), [router]);
  const { me, sharedLoading, storeHours, settings, employees: cachedEmployees, cacheEmployees } = useAppData();
  const { timezone, firstDayOfWeek } = settings;
  const todayKey = useStoreTodayKey(timezone);

  const { mode, weekStart } = parseWeekParams(searchParams, todayKey, firstDayOfWeek);
  const isDraftMode = mode === "draft";
  const thisWeek = weekStartForKey(todayKey, firstDayOfWeek);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const [employees, setEmployees] = useState<PlannerEmployee[]>(() => cachedEmployees);
  const [timeOff, setTimeOff] = useState<PendingTimeOff[]>([]);
  const [profiles, setProfiles] = useState<CoverageProfile[]>([]);
  const [defaults, setDefaults] = useState<CoverageDefaults>({});
  const [overrides, setOverrides] = useState<CoverageOverrides>({});
  const [coverageUnavailable, setCoverageUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The day the charts and day list follow, as a weekday so it carries across
  // weeks (and survives the week's start day arriving with the settings).
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  // The cell open in the editor.
  const [picked, setPicked] = useState<{ employeeId: number; date: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Managers only; everyone else goes back to the dashboard.
  useEffect(() => {
    if (!sharedLoading && !me.isManager) router.replace("/");
  }, [sharedLoading, me.isManager, router]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/employees", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: PlannerEmployee[]) => {
        if (Array.isArray(data)) { setEmployees(data); cacheEmployees(data); }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError("Couldn't load the team. Refresh to try again."); });
    apiFetch("/api/time-off", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data && Array.isArray(data.requests)) setTimeOff(data.requests); })
      .catch(() => {});
    return () => controller.abort();
  }, [apiFetch, cacheEmployees]);

  // Coverage targets for the week: each date's profile override, else its weekday default.
  useEffect(() => {
    if (sharedLoading) return;
    let cancelled = false;
    Promise.all([
      apiFetch("/api/coverage-profiles").then((r) => (r.ok ? r.json() : Promise.reject())),
      apiFetch(`/api/coverage-assignments?from=${dates[0]}&to=${dates[6]}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([profileRows, assignments]) => {
        if (cancelled) return;
        if (Array.isArray(profileRows)) setProfiles(profileRows);
        setDefaults(assignments?.defaults ?? {});
        setOverrides(assignments?.overrides ?? {});
        setCoverageUnavailable(false);
      })
      .catch(() => { if (!cancelled) setCoverageUnavailable(true); });
    return () => { cancelled = true; };
  }, [apiFetch, sharedLoading, dates]);

  const week = useWeekShifts({ enabled: !sharedLoading, dates, apiFetch });
  const { live, drafts } = week;
  const loading = week.loading || sharedLoading;
  // Until the first week has loaded, the day list's length (the team) isn't
  // known, so what sits under it waits rather than being pushed down.
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  if (!loading && !firstLoadDone) setFirstLoadDone(true);
  const auto = useAutoSchedule({
    enabled: !sharedLoading && isDraftMode,
    weekStart,
    apiFetch,
    onDraftsChanged: week.reloadDrafts,
  });

  // Drafts whose person already has a live shift that day: publishing skips them.
  const clashes = useMemo(() => clashingDrafts(live, drafts), [live, drafts]);
  const publishCount = drafts.length - clashes.length;
  // What the grid and day list show: live shifts, plus drafts in Draft mode.
  const gridShifts = useMemo(() => (isDraftMode ? [...live, ...drafts] : live), [isDraftMode, live, drafts]);
  // What the numbers count: the live week, or the week after publishing.
  const counted = useMemo(() => (isDraftMode ? projectedShifts(live, drafts) : live), [isDraftMode, live, drafts]);
  const cells = useMemo(() => weekCells(gridShifts, mode), [gridShifts, mode]);

  const curves = useMemo(
    (): Record<string, CoverageBlock[]> =>
      Object.fromEntries(dates.map((d) => [d, curveForDate(d, overrides, defaults, profiles)])),
    [dates, overrides, defaults, profiles]
  );

  // Until a day is picked: today in this week, else the week's first day.
  const selectedDate =
    (pickedDay === null ? undefined : dates.find((d) => dayOfWeekForKey(d) === pickedDay)) ??
    (dates.includes(todayKey) ? todayKey : dates[0]);
  const selectDate = (date: string) => setPickedDay(dayOfWeekForKey(date));

  // ---- Navigation: the mode and week live in the URL ----
  // Written with history.replaceState, which Next.js applies to
  // useSearchParams on the spot. router.replace would ask the server for the
  // page again first, so the week on screen changed a round trip after the
  // tap (well over a second on a slow connection), all at once.
  function showWeek(nextMode: WeekMode, nextWeek: string) {
    window.history.replaceState(null, "", weekHref(nextMode, nextWeek));
  }
  function go(nextMode: WeekMode, nextWeek: string) {
    // The week's start day comes with the settings; a week picked before
    // then could snap back to the one it was picked from.
    if (sharedLoading) return;
    setPublishResult(null);
    if (nextWeek !== weekStart) setPicked(null);
    showWeek(nextMode, nextWeek);
  }
  const goToWeek = (next: string) => go(mode, next);

  // ←/→ change the week, T jumps to this week. Ignored while typing or while
  // the editor, Auto-schedule or the publish dialog is open.
  const pickedCell = picked && dates.includes(picked.date) ? picked : null;
  const overlayOpen = pickedCell !== null || auto.sheetOpen || confirmPublish;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (overlayOpen || e.metaKey || e.ctrlKey || e.altKey || typingInField(e.target)) return;
      if (e.key === "ArrowLeft") goToWeek(addDaysToKey(weekStart, -7));
      else if (e.key === "ArrowRight") goToWeek(addDaysToKey(weekStart, 7));
      else if (e.key === "t" || e.key === "T") goToWeek(thisWeek);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---- The editor ----
  // Live: the live shift. Draft: the draft (a clash opens the draft, so it can
  // be removed); a live shift is view only, with a way back to Live.
  const pickedEmp = pickedCell ? employees.find((e) => e.id === pickedCell.employeeId) ?? null : null;
  const cell = pickedCell ? cells.get(cellKey(pickedCell.employeeId, pickedCell.date)) : undefined;
  const editor: { source: WeekMode; shift: SourcedShift | null; readOnly: boolean; notice?: string } = !isDraftMode
    ? { source: "live", shift: cell?.live ?? null, readOnly: false }
    : cell?.draft
    ? {
        source: "draft",
        shift: cell.draft,
        readOnly: false,
        notice: cell.live
          ? `This draft won't publish: there's already a live shift that day (${fmtMinutes(cell.live.startMinutes)} – ${fmtMinutes(cell.live.endMinutes)}). Remove the draft, or change the live shift in Live mode.`
          : undefined,
      }
    : cell?.live
    ? { source: "live", shift: cell.live, readOnly: true }
    : { source: "draft", shift: null, readOnly: false };

  function openCell(employeeId: number, date: string) {
    setPicked({ employeeId, date });
    selectDate(date);
  }

  // ---- Coverage, team and publishing ----
  async function handleAssignProfile(date: string, profileId: number | null) {
    setActionError(null);
    try {
      const res = await apiFetch("/api/coverage-assignments", {
        method: profileId === null ? "DELETE" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(profileId === null ? { date } : { date, profileId }),
      });
      if (!res.ok) await throwApiError(res, "Failed to update coverage assignment");
      setOverrides((prev) => {
        const next = { ...prev };
        if (profileId === null) delete next[date];
        else next[date] = profileId;
        return next;
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update coverage assignment");
    }
  }

  async function handleSetEmploymentType(employeeId: number, type: EmploymentType) {
    const res = await apiFetch("/api/employees", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: employeeId, employmentType: type }),
    });
    if (!res.ok) return;
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, employment_type: type } : e)));
  }

  async function handlePublish() {
    setPublishing(true);
    setActionError(null);
    try {
      const res = await apiFetch("/api/drafts/publish", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ weekStart }),
      });
      if (!res.ok) await throwApiError(res, "Failed to publish schedule");
      const result = await res.json().catch(() => ({}));
      auto.clearRun();
      setConfirmPublish(false);
      // Show the published week, live.
      showWeek("live", weekStart);
      setPublishResult({
        weekStart,
        published: Number(result.published) || 0,
        skipped: Array.isArray(result.skippedDrafts) ? result.skippedDrafts : [],
      });
      week.reloadAll().catch(() => setActionError("Published. Refresh to see the week's shifts."));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to publish schedule");
      setConfirmPublish(false);
    } finally {
      setPublishing(false);
    }
  }

  // The day picker for the charts' "Change day": the chips on phones, the
  // grid's day headers from tablets up. Bring it into view on the selected day.
  function focusDayPicker() {
    const picker = [
      document.getElementById("week-day-picker"),
      document.querySelector<HTMLElement>('[data-testid="week-grid"] thead'),
    ].find((el) => el && el.offsetParent !== null);
    picker?.scrollIntoView({ behavior: "smooth", block: "center" });
    picker?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  const nameOf = (id: number) => {
    const emp = employees.find((e) => e.id === id);
    return emp ? formatDisplayName(emp.name) : "Someone";
  };
  const banner = publishResult && !isDraftMode && publishResult.weekStart === weekStart ? publishResult : null;
  const skippedText = !banner || banner.skipped.length === 0
    ? null
    : banner.skipped.length === 1
    ? `1 draft stayed in Draft: ${nameOf(banner.skipped[0].employeeId)} already has a live shift on ${formatDateKey(banner.skipped[0].date, { weekday: "short", month: "short", day: "numeric" })}.`
    : `${banner.skipped.length} drafts stayed in Draft; those people already have a live shift that day: ${banner.skipped
        .slice(0, 3)
        .map((s) => `${nameOf(s.employeeId)} (${formatDateKey(s.date, { weekday: "short" })})`)
        .join(", ")}${banner.skipped.length > 3 ? `, and ${banner.skipped.length - 3} more` : ""}.`;

  const missingTables = [
    isDraftMode && week.draftsUnavailable && "draft schedules",
    coverageUnavailable && "coverage profiles",
  ].filter(Boolean);
  const errorText = actionError ?? week.error ?? loadError;
  const weekLabel = `${formatDateKey(dates[0], { month: "short", day: "numeric" })} – ${formatDateKey(dates[6], { month: "short", day: "numeric", year: "numeric" })}`;
  const pickedDow = pickedCell ? dayOfWeekForKey(pickedCell.date) : 0;

  // Draft mode with nothing drafted yet. It arrives with the week's data, so
  // it's shown with it: in the day list on phones (its rows land at the same
  // moment) and under the grid on larger screens — never above the page,
  // where it would push everything down when the week loads.
  const showDraftsEmpty = isDraftMode && !loading && !week.draftsUnavailable && drafts.length === 0 && !auto.currentRun && employees.length > 0;
  const draftsEmptyText = (
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-slate-100">No drafts for this week yet</div>
      <div className="text-xs text-slate-400 mt-0.5">
        Auto-schedule drafts the week from your coverage targets, availability, time off and hours, around the shifts already live. You review it before anything is published.
      </div>
    </div>
  );

  return (
    <AppShell active="week" isManager>
      <main
        className={`max-w-[480px] mx-auto pb-28 bg-bg min-h-dvh tablet:max-w-none tablet:pb-10 ${
          pickedCell ? "wide:pr-[420px]" : ""
        }`}
      >
        <WeekHeader
          mode={mode}
          weekLabel={weekLabel}
          isThisWeek={weekStart === thisWeek}
          ready={!sharedLoading}
          draftCount={drafts.length}
          publishCount={publishCount}
          busy={loading}
          onModeChange={(next) => go(next, weekStart)}
          onPrevWeek={() => goToWeek(addDaysToKey(weekStart, -7))}
          onNextWeek={() => goToWeek(addDaysToKey(weekStart, 7))}
          onThisWeek={() => goToWeek(thisWeek)}
          onAutoSchedule={auto.openSheet}
          onPublish={() => setConfirmPublish(true)}
          onBack={() => router.back()}
        />

        {/* Banners sit over the page (components/Toast.tsx), so one showing
            up or going away doesn't push the week down. */}
        <ToastStack>
          {missingTables.length > 0 && (
            <Toast tone="warning" role="alert" className="text-xs">
              Database tables are missing ({missingTables.join(" and ")}). Apply the migrations in{" "}
              <code className="font-mono">supabase/migrations/</code> in the Supabase SQL editor.
            </Toast>
          )}
          {errorText && (
            <Toast onDismiss={actionError ? () => setActionError(null) : undefined}>
              {errorText}
            </Toast>
          )}
          {banner && (
            <Toast tone="success" data-testid="publish-result" onDismiss={() => setPublishResult(null)}>
              <div className="font-semibold">
                Published {banner.published} shift{banner.published === 1 ? "" : "s"}. The team can see {banner.published === 1 ? "it" : "them"} now.
              </div>
              {skippedText && <div className="text-xs text-amber-400 mt-1">{skippedText}</div>}
            </Toast>
          )}
        </ToastStack>

        {isDraftMode && auto.showSummary && auto.currentRun && (
          <AutoScheduleSummary
            run={auto.currentRun}
            employees={employees}
            busy={auto.summaryBusy}
            error={auto.summaryError}
            onUndo={auto.undo}
            onTryAnother={auto.tryAnother}
            onApplySuggestion={auto.applySuggestion}
            onDismiss={auto.dismissSummary}
          />
        )}

        <div className="px-4 pt-4 tablet:px-6 wide:max-w-[1680px] wide:mx-auto">
          <div className="mb-4">
            <WeekStats shifts={counted} dates={dates} curves={curves} timezone={timezone} loading={loading} />
          </div>

          {/* The editor. Phones: pick a day, see everyone. Tablets and up: the team grid. */}
          <div className="tablet:hidden">
            <DayChips dates={dates} selectedDate={selectedDate} onSelectDate={selectDate} shifts={counted} curves={curves} timezone={timezone} ready={!sharedLoading} />
          </div>
          <DayToolbar
            date={selectedDate}
            shifts={counted}
            curves={curves}
            timezone={timezone}
            profiles={profiles}
            defaults={defaults}
            overrides={overrides}
            onAssignProfile={handleAssignProfile}
          />
          <div className="tablet:hidden">
            <DayList
              notice={showDraftsEmpty ? (
                <div data-testid="auto-schedule-empty" className="px-4 py-3.5 bg-violet-500/[0.06] flex items-center gap-3">
                  {draftsEmptyText}
                </div>
              ) : null}
              mode={mode}
              date={selectedDate}
              dates={dates}
              employees={employees}
              shifts={gridShifts}
              storeHours={storeHours}
              timeOff={timeOff}
              rules={settings.schedulingRules}
              timezone={timezone}
              loading={loading}
              selected={pickedCell}
              onSelect={(emp, date) => openCell(emp.id, date)}
            />
          </div>
          <div className={`hidden tablet:block mb-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            <WeekGrid
              employees={employees}
              schedules={gridShifts}
              dates={dates}
              weeklyHours={storeHours}
              todayKey={todayKey}
              mode={mode}
              timezone={timezone}
              timeOff={timeOff}
              selected={pickedCell}
              onSelect={(emp, date) => openCell(emp.id, date)}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
            />
            {showDraftsEmpty && (
              <div
                data-testid="auto-schedule-empty"
                className="mt-3 px-4 py-3.5 rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] flex items-center gap-3"
              >
                {draftsEmptyText}
                <button
                  type="button"
                  onClick={auto.openSheet}
                  className="px-3.5 py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/35 text-violet-100 font-bold text-xs cursor-pointer hover:bg-violet-500/30 transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <Sparkle />
                  Auto-schedule
                </button>
              </div>
            )}
            <p className="hidden desk:block mt-3 text-xs text-slate-500">
              Click a cell to {isDraftMode ? "draft" : "edit or add"} a shift, or a day to see its coverage.{" "}
              <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> change the week, <kbd className="font-mono">T</kbd> returns to this week.
            </p>
          </div>

          {firstLoadDone && (
            <WeekInsights
              shifts={counted}
              dates={dates}
              curves={curves}
              storeHours={storeHours}
              employees={employees}
              rules={settings.schedulingRules}
              timezone={timezone}
              loading={loading}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onPickDay={focusDayPicker}
            />
          )}
        </div>

        <EmployeeDrawer
          open={pickedEmp !== null}
          employee={pickedEmp}
          schedule={editor.shift}
          storeHours={storeHours[pickedDow] ?? { open: 0, close: 1440 }}
          nowMinutes={nowMinutesInTz(timezone)}
          isToday={!isDraftMode && pickedCell?.date === todayKey}
          date={pickedCell?.date}
          isManager
          source={editor.source}
          readOnly={editor.readOnly}
          notice={editor.notice}
          onSwitchToLive={() => go("live", weekStart)}
          onClose={() => setPicked(null)}
          onSave={(id, startMinutes, endMinutes, override = false) => week.save(editor.source, id, startMinutes, endMinutes, override)}
          onCreate={(employeeId, startMinutes, endMinutes, override = false) =>
            week.create(editor.source, employeeId, pickedCell!.date, startMinutes, endMinutes, override)}
          onMarkOff={(id) => week.remove(editor.source, id)}
        />

        {isDraftMode && (
          <AutoScheduleSheet
            open={auto.sheetOpen}
            onClose={auto.closeSheet}
            weekLabel={weekLabel}
            dates={dates}
            employees={employees}
            draftCount={drafts.length}
            curves={curves}
            rules={settings.schedulingRules}
            initialAdjustments={auto.currentRun?.adjustments ?? []}
            generating={auto.generating}
            error={auto.sheetError}
            onGenerate={auto.generate}
            onSetEmploymentType={handleSetEmploymentType}
          />
        )}

        <PublishDialog
          open={confirmPublish}
          publishing={publishing}
          weekLabel={weekLabel}
          publishCount={publishCount}
          clashCount={clashes.length}
          onCancel={() => setConfirmPublish(false)}
          onConfirm={handlePublish}
        />

        <BottomNav active="week" />
      </main>
    </AppShell>
  );
}
