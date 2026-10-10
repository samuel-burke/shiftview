"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast, ToastStack } from "@/components/Toast";
import AppShell from "../../components/AppShell";
import BottomNav from "../../components/BottomNav";
import { useAppData } from "@/lib/AppDataContext";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useManagerRequests } from "@/hooks/useManagerRequests";
import { dateKeyInTz, formatDateKey, formatTimeInTz } from "@/lib/dates";
import { fmtMinutes, getMonogram, type Employee, type Schedule } from "@/data/types";

type Kind = "timeoff" | "swap" | "correction";
type Filter = "all" | Kind;

type Item = {
  key: string;
  kind: Kind;
  id: number;
  /** Who the request is from (both people for a swap). */
  title: string;
  /** One line describing what's being asked. */
  summary: string;
  /** Store-local day the request affects. */
  date: string;
  note?: string;
  /** Employees whose shifts on `date` the request is about, to highlight. */
  employeeNames: string[];
  detail: { label: string; value: string }[];
};

const KIND_LABEL: Record<Kind, string> = { timeoff: "Time off", swap: "Shift swap", correction: "Punch correction" };
/** Compact labels for the list rows. */
const KIND_TAG: Record<Kind, string> = { timeoff: "Time off", swap: "Swap", correction: "Fix" };
const KIND_COLOR: Record<Kind, string> = { timeoff: "#a78bfa", swap: "#60a5fa", correction: "#fbbf24" };
const PUNCH_LABEL = { clock_in: "Clock in", clock_out: "Clock out", break_start: "Break start", break_end: "Break end" } as const;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "timeoff", label: "Time off" },
  { key: "swap", label: "Swaps" },
  { key: "correction", label: "Corrections" },
];

function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const longDate = (key: string) => formatDateKey(key, { weekday: "long", month: "long", day: "numeric" });
const shortDate = (key: string) => formatDateKey(key, { weekday: "short", month: "short", day: "numeric" });

/*
 * Manager inbox for everything awaiting a decision. Layout by size class:
 * compact: the list, or one request's detail with a back link.
 * tablet:  type filter chips above a list | detail split.
 * desk+:   type filters | list | detail with that day's schedule.
 * Keyboard (desk+): ↑/↓ move through the list, A approves, D denies.
 */
export default function RequestsPageClient() {
  const router = useRouter();
  const { me, sharedLoading, settings } = useAppData();
  const { timezone } = settings;
  const size = useBreakpoint();
  const requests = useManagerRequests(me.isManager);

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [daySchedules, setDaySchedules] = useState<{ date: string; schedules: Schedule[] } | null>(null);

  useEffect(() => {
    if (!sharedLoading && !me.isManager) router.replace("/");
  }, [sharedLoading, me.isManager, router]);

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setEmployees(data); })
      .catch(() => {});
  }, []);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...requests.timeOff.map((r): Item => ({
        key: `timeoff-${r.id}`,
        kind: "timeoff",
        id: r.id,
        title: r.employeeName,
        summary: `Off ${shortDate(r.date)}`,
        date: r.date,
        note: r.note,
        employeeNames: [r.employeeName],
        detail: [{ label: "Day", value: longDate(r.date) }],
      })),
      ...requests.swaps.map((s): Item => ({
        key: `swap-${s.id}`,
        kind: "swap",
        id: s.id,
        title: `${s.requesterName} ↔ ${s.targetName}`,
        summary: `Swap ${s.date ? shortDate(s.date) : ""}`.trim(),
        date: s.date,
        employeeNames: [s.requesterName, s.targetName],
        detail: [
          { label: "Day", value: s.date ? longDate(s.date) : "—" },
          { label: `${s.requesterName}'s shift`, value: s.scheduleATime || "—" },
          { label: `${s.targetName}'s shift`, value: s.scheduleBTime || "—" },
          { label: "Status", value: `${s.targetName} accepted · waiting on you` },
        ],
      })),
      ...requests.corrections.map((c): Item => {
        const date = dateKeyInTz(c.punchedAt, timezone);
        return {
          key: `correction-${c.id}`,
          kind: "correction",
          id: c.id,
          title: c.employeeName,
          summary: `Missed ${PUNCH_LABEL[c.punchType].toLowerCase()} · ${shortDate(date)}`,
          date,
          note: c.note,
          employeeNames: [c.employeeName],
          detail: [
            { label: "Punch", value: PUNCH_LABEL[c.punchType] },
            { label: "When", value: `${longDate(date)} at ${formatTimeInTz(c.punchedAt, timezone)}` },
          ],
        };
      }),
    ];
    // Soonest day first: those decisions are the most urgent.
    return all.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.key.localeCompare(b.key));
  }, [requests.timeOff, requests.swaps, requests.corrections, timezone]);

  const counts: Record<Filter, number> = {
    all: items.length,
    timeoff: requests.timeOff.length,
    swap: requests.swaps.length,
    correction: requests.corrections.length,
  };
  const visible = filter === "all" ? items : items.filter((i) => i.kind === filter);

  // Wider screens always show a request in the detail pane; phones show the
  // list until one is tapped.
  const autoSelect = size !== "compact";
  const selected =
    visible.find((i) => i.key === selectedKey) ?? (autoSelect ? visible[0] ?? null : null);

  // The selected day's schedule, for context next to the decision.
  const selectedDate = selected?.date || null;
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    fetch(`/api/schedules?date=${selectedDate}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setDaySchedules({ date: selectedDate, schedules: Array.isArray(data) ? data : [] });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Optimistic (useManagerRequests): the request leaves the list and the
  // neighbour is selected at the tap, so a manager can work down the list;
  // if the server refuses, it comes back, selected, with the reason.
  async function decide(item: Item, status: "approved" | "denied") {
    const idx = visible.findIndex((i) => i.key === item.key);
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null;
    setError(null);
    setSelectedKey(autoSelect ? next?.key ?? null : null);
    try {
      if (item.kind === "timeoff") await requests.decideTimeOff(item.id, status);
      else if (item.kind === "swap") await requests.decideSwap(item.id, status);
      else await requests.decideCorrection(item.id, status);
    } catch (e) {
      setSelectedKey(item.key);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  }

  useEffect(() => {
    if (size === "compact" || size === "tablet") return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e.target)) return;
      const idx = selected ? visible.findIndex((i) => i.key === selected.key) : -1;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const n = visible[Math.min(visible.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        if (n) { e.preventDefault(); setSelectedKey(n.key); }
      } else if (selected && (e.key === "a" || e.key === "A")) {
        decide(selected, "approved");
      } else if (selected && (e.key === "d" || e.key === "D")) {
        decide(selected, "denied");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const empMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const dayList =
    daySchedules && selected && daySchedules.date === selected.date
      ? [...daySchedules.schedules].sort((a, b) => a.startMinutes - b.startMinutes)
      : null;

  const showListOnPhone = !selected;

  return (
    <AppShell active="requests" isManager>
      <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-dvh tablet:max-w-none tablet:pb-10">
        {/* Header */}
        <div
          className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg tablet:px-6 desk:py-[14px]"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => (selected && size === "compact" ? setSelectedKey(null) : router.back())}
            aria-label="Back"
            className="tablet:hidden size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <h1 className="flex-1 text-xl font-extrabold text-slate-100 tracking-tight">
            Requests
            {items.length > 0 && (
              <span className="ml-2 align-middle text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 tabular-nums">
                {items.length}
              </span>
            )}
          </h1>
          <span className="hidden desk:block text-xs text-slate-500">
            <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> move · <kbd className="font-mono">A</kbd> approve · <kbd className="font-mono">D</kbd> deny
          </span>
        </div>

        <div className="px-4 pt-4 tablet:px-6 desk:grid desk:grid-cols-[180px_minmax(0,400px)_minmax(0,1fr)] desk:gap-6 wide:max-w-[1680px] wide:mx-auto">
          {/* Type filters: chips above the list below desk, a column from desk up */}
          <nav
            aria-label="Request types"
            className={`flex gap-2 overflow-x-auto pb-3 desk:flex-col desk:gap-0.5 desk:pb-0 desk:sticky desk:top-4 desk:self-start ${
              showListOnPhone ? "" : "hidden tablet:flex"
            }`}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setSelectedKey(null); }}
                aria-pressed={filter === f.key}
                className={`shrink-0 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors cursor-pointer border ${
                  filter === f.key
                    ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-300"
                    : "bg-card border-slate-800 text-slate-400 hover:text-slate-200 desk:bg-transparent desk:border-transparent desk:hover:bg-slate-800"
                }`}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-80">{counts[f.key]}</span>
              </button>
            ))}
          </nav>

          <div className="tablet:grid tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] tablet:gap-5 desk:contents">
            {/* List */}
            <ul
              aria-label="Pending requests"
              className={`flex flex-col gap-2 ${showListOnPhone ? "" : "hidden tablet:flex"} desk:self-start`}
            >
              {!requests.loaded && (
                <li className="text-sm text-slate-500 px-1 py-6" aria-busy="true">Loading requests…</li>
              )}
              {requests.loaded && visible.length === 0 && (
                <li className="rounded-2xl border border-dashed border-slate-700 px-5 py-10 text-center">
                  <div className="text-sm font-semibold text-slate-200">Nothing waiting on you</div>
                  <div className="mt-1 text-xs text-slate-500">New time off, swaps and punch corrections show up here.</div>
                </li>
              )}
              {visible.map((item) => {
                const isSel = selected?.key === item.key;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => setSelectedKey(item.key)}
                      aria-current={isSel ? "true" : undefined}
                      className={`w-full text-left rounded-xl border px-3.5 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
                        isSel ? "bg-indigo-600/15 border-indigo-500/40" : "bg-card border-slate-800 hover:border-slate-700"
                      }`}
                      style={{ boxShadow: `inset 3px 0 0 ${KIND_COLOR[item.kind]}` }}
                    >
                      <span className="size-9 shrink-0 rounded-full border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300 flex items-center justify-center">
                        {getMonogram(item.employeeNames[0] ?? "?")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-100">{item.title}</span>
                        <span className="block truncate text-xs text-slate-400">{item.summary}</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: KIND_COLOR[item.kind] }}>
                        {KIND_TAG[item.kind]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Detail */}
            <section
              aria-label="Request detail"
              className={`${selected ? "" : "hidden tablet:block"} desk:self-start desk:sticky desk:top-4`}
              data-testid="request-detail"
            >
              {selected ? (
                <div className="rounded-2xl border border-slate-800 bg-card p-5 tablet:p-6 flex flex-col gap-5">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: KIND_COLOR[selected.kind] }}>
                      {KIND_LABEL[selected.kind]}
                    </div>
                    <h2 className="mt-1 text-lg font-extrabold text-slate-100">{selected.title}</h2>
                  </div>

                  <dl className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
                    {selected.detail.map((d) => (
                      <div key={d.label} className="rounded-xl bg-slate-800/40 border border-slate-800 px-3.5 py-2.5 min-w-0">
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{d.label}</dt>
                        <dd className="text-sm font-semibold text-slate-100 break-words">{d.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {selected.note && (
                    <blockquote className="rounded-xl border-l-2 border-slate-600 bg-slate-800/30 px-4 py-3 text-sm text-slate-300">
                      “{selected.note}”
                    </blockquote>
                  )}

                  {selected.date && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        On the schedule {shortDate(selected.date)}
                        {dayList && <span className="ml-1 normal-case tracking-normal text-slate-400">· {dayList.length} {dayList.length === 1 ? "shift" : "shifts"}</span>}
                      </div>
                      {dayList === null ? (
                        <div className="text-xs text-slate-500">Loading…</div>
                      ) : dayList.length === 0 ? (
                        <div className="text-xs text-slate-500">No one is scheduled that day.</div>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {dayList.map((s) => {
                            const name = empMap[s.employeeId]?.name ?? "Unknown";
                            const involved = selected.employeeNames.includes(name);
                            return (
                              <li
                                key={s.id}
                                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                                  involved ? "bg-amber-500/10 text-amber-300 font-semibold" : "text-slate-300"
                                }`}
                              >
                                <span className="truncate">{name}</span>
                                <span className="tabular-nums text-xs">{fmtMinutes(s.startMinutes)} – {fmtMinutes(s.endMinutes)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => decide(selected, "denied")}
                      className="flex-1 py-3 rounded-xl text-sm font-bold text-red-400 bg-red-500/10 border border-red-500/25 cursor-pointer hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Deny
                    </button>
                    <button
                      onClick={() => decide(selected, "approved")}
                      className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 cursor-pointer hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 px-6 py-16 text-center text-sm text-slate-500">
                  Pick a request to see the details.
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Page level, so it outlives the selection moving on (decide()). */}
        <ToastStack>
          {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
        </ToastStack>

        <BottomNav active="requests" />
      </main>
    </AppShell>
  );
}
