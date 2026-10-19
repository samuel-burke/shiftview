"use client";

import { useEffect, useRef, useState } from "react";
import {
  BREAK_TYPE_MIN_MINUTES_MAX,
  BREAK_TYPE_NAME_MAX,
  DEFAULT_BREAK_TYPE,
  activeBreakTypes,
  type BreakRules,
  type BreakType,
} from "@/lib/break-rules";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";
import SettingsSectionLabel from "./SettingsSectionLabel";
import FormError from "./FormError";

// Settings → Breaks (manager only): the store's break types and the optional
// meal and attestation rules (lib/break-rules.ts). The types come in with the
// page's first load, so nothing here grows once the page shows. Each change
// saves straight away, like the other workplace settings.

// Meal rule thresholds in half-hour steps, 1–16 h of work.
const MEAL_AFTER_OPTIONS = Array.from({ length: 31 }, (_, i) => 60 + i * 30);
const DEFAULT_MEAL_AFTER = 300;

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

const fieldClass =
  "bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-accent";

function Switch({ checked, label, testId, disabled, onChange }: {
  checked: boolean; label: string; testId: string; disabled?: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
        checked ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// Minutes typed into a field: "" is none; otherwise a whole number in range.
function parseMinField(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= BREAK_TYPE_MIN_MINUTES_MAX ? { ok: true, value: n } : { ok: false };
}

function TypeRow({ type, busy, onPatch }: {
  type: BreakType; busy: boolean; onPatch: (patch: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(type.name);
  const [min, setMin] = useState(type.minMinutes != null ? String(type.minMinutes) : "");
  // Follow a value saved (or reverted) elsewhere.
  const [shown, setShown] = useState(type);
  if (type !== shown) {
    setShown(type);
    setName(type.name);
    setMin(type.minMinutes != null ? String(type.minMinutes) : "");
  }
  return (
    <li data-testid={`break-type-${type.id}`} className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
      <input
        aria-label={`Name of ${type.name}`}
        value={name}
        maxLength={BREAK_TYPE_NAME_MAX}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.replace(/\s+/g, " ").trim();
          if (!n) { setName(type.name); return; }
          if (n !== type.name) onPatch({ name: n });
        }}
        className={`${fieldClass} flex-1 min-w-[8rem]`}
      />
      <select
        aria-label={`Is ${type.name} paid`}
        value={type.paid ? "paid" : "unpaid"}
        disabled={busy}
        onChange={(e) => onPatch({ paid: e.target.value === "paid" })}
        className={`${fieldClass} cursor-pointer`}
      >
        <option value="unpaid">Unpaid</option>
        <option value="paid">Paid</option>
      </select>
      <input
        aria-label={`Minimum minutes for ${type.name}`}
        type="number"
        inputMode="numeric"
        min={1}
        max={BREAK_TYPE_MIN_MINUTES_MAX}
        placeholder="Min"
        value={min}
        disabled={busy}
        onChange={(e) => setMin(e.target.value)}
        onBlur={() => {
          const v = parseMinField(min);
          if (!v.ok) { setMin(type.minMinutes != null ? String(type.minMinutes) : ""); return; }
          if (v.value !== type.minMinutes) onPatch({ minMinutes: v.value });
        }}
        className={`${fieldClass} w-16 text-right tabular-nums`}
      />
      <span className="text-xs text-fg-subtle">min</span>
      <button
        onClick={() => onPatch({ archived: true })}
        disabled={busy}
        className="text-xs font-semibold text-fg-muted hover:text-danger-fg cursor-pointer disabled:opacity-50"
      >
        Archive
      </button>
    </li>
  );
}

export default function BreaksSection({
  types: initialTypes,
  rules,
  onRulesSaved,
}: {
  types: BreakType[];
  rules: BreakRules;
  onRulesSaved: (rules: BreakRules) => void;
}) {
  const [types, setTypes] = useState(initialTypes);
  const [shownTypes, setShownTypes] = useState(initialTypes);
  if (initialTypes !== shownTypes) {
    setShownTypes(initialTypes);
    setTypes(initialTypes);
  }
  const [draft, setDraft] = useState(rules);
  const [shownRules, setShownRules] = useState(rules);
  if (rules !== shownRules) {
    setShownRules(rules);
    setDraft(rules);
  }

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPaid, setNewPaid] = useState(false);
  const [newMin, setNewMin] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  function flash(next: SaveStatus, ms: number) {
    setStatus(next);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus("idle"), ms);
  }

  async function reloadTypes() {
    const res = await fetch("/api/break-types?all=1").catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body && Array.isArray(body.breakTypes)) setTypes(body.breakTypes);
  }

  async function send(url: string, method: string, payload: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setStatus("saving");
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const ok = !!res?.ok;
    if (!ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.error ?? "Couldn't save. Try again.");
      flash("error", 4000);
    } else {
      flash("saved", 2000);
    }
    if (url.startsWith("/api/break-types")) await reloadTypes();
    setBusy(false);
    return ok;
  }

  async function addType() {
    const name = newName.replace(/\s+/g, " ").trim();
    if (!name) { setError("Give the break type a name"); return; }
    const min = parseMinField(newMin);
    if (!min.ok) { setError(`Minimum length must be 1–${BREAK_TYPE_MIN_MINUTES_MAX} minutes, or blank`); return; }
    if (await send("/api/break-types", "POST", { name, paid: newPaid, minMinutes: min.value })) {
      setNewName("");
      setNewPaid(false);
      setNewMin("");
    }
  }

  async function saveRules(patch: Partial<BreakRules>) {
    const prev = draft;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (await send("/api/settings", "PUT", { breakRules: patch })) onRulesSaved(next);
    else setDraft(prev);
  }

  const active = activeBreakTypes(types);
  const archived = types.filter((t) => t.archived);
  const mealOn = draft.mealRequiredAfterMinutes > 0;

  return (
    <section data-testid="breaks-section">
      <SettingsSectionLabel label="Breaks">
        <SaveStatusText status={status} testId="breaks-status" />
      </SettingsSectionLabel>
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-4">
        <div className="pb-4 border-b border-line/60">
          <div className="text-sm font-semibold text-fg-body">Break Types</div>
          <div className="text-xs text-fg-subtle mt-0.5">
            Unpaid breaks come off worked hours; paid breaks count as work. With more than one type, employees pick one when they start a break.
          </div>
          {active.length === 0 ? (
            <div data-testid="break-type-default" className="mt-3 text-xs text-fg-muted">
              {DEFAULT_BREAK_TYPE.name} · Unpaid — every break is unpaid until you add types.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line/60">
              {active.map((t) => (
                <TypeRow key={t.id} type={t} busy={busy} onPatch={(patch) => send(`/api/break-types/${t.id}`, "PATCH", patch)} />
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              aria-label="New break type name"
              placeholder="New type, e.g. Meal"
              value={newName}
              maxLength={BREAK_TYPE_NAME_MAX}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              className={`${fieldClass} flex-1 min-w-[8rem]`}
            />
            <select
              aria-label="Is the new break type paid"
              value={newPaid ? "paid" : "unpaid"}
              disabled={busy}
              onChange={(e) => setNewPaid(e.target.value === "paid")}
              className={`${fieldClass} cursor-pointer`}
            >
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </select>
            <input
              aria-label="Minimum minutes for the new break type"
              type="number"
              inputMode="numeric"
              min={1}
              max={BREAK_TYPE_MIN_MINUTES_MAX}
              placeholder="Min"
              value={newMin}
              disabled={busy}
              onChange={(e) => setNewMin(e.target.value)}
              className={`${fieldClass} w-16 text-right tabular-nums`}
            />
            <button
              onClick={addType}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-accent text-on-accent cursor-pointer disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <FormError message={error} />
          {archived.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-fg-subtle cursor-pointer">Archived ({archived.length})</summary>
              <ul className="mt-2 space-y-1">
                {archived.map((t) => (
                  <li key={t.id} className="flex items-center justify-between text-xs text-fg-muted">
                    <span>{t.name} · {t.paid ? "Paid" : "Unpaid"}</span>
                    <button
                      onClick={() => send(`/api/break-types/${t.id}`, "PATCH", { archived: false })}
                      disabled={busy}
                      className="font-semibold text-accent-fg cursor-pointer disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pb-4 border-b border-line/60">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg-body">Meal Break Rule</div>
            <div className="text-xs text-fg-subtle mt-0.5">
              Flag shifts with no unpaid meal break by this many hours of work, on time cards and in the payroll export
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Meal required after"
              value={mealOn ? draft.mealRequiredAfterMinutes : DEFAULT_MEAL_AFTER}
              disabled={busy || !mealOn}
              onChange={(e) => saveRules({ mealRequiredAfterMinutes: Number(e.target.value) })}
              className={`${fieldClass} cursor-pointer tabular-nums disabled:opacity-50`}
            >
              {MEAL_AFTER_OPTIONS.map((m) => <option key={m} value={m}>{fmtHours(m)}</option>)}
            </select>
            <Switch
              checked={mealOn}
              label="Meal break rule"
              testId="toggle-meal-rule"
              disabled={busy}
              onChange={(on) => saveRules({ mealRequiredAfterMinutes: on ? DEFAULT_MEAL_AFTER : 0 })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg-body">Break Attestation</div>
            <div className="text-xs text-fg-subtle mt-0.5">Ask at clock-out whether the employee could take their breaks</div>
          </div>
          <Switch
            checked={draft.attestationEnabled}
            label="Break attestation at clock-out"
            testId="toggle-break-attestation"
            disabled={busy}
            onChange={(on) => saveRules({ attestationEnabled: on })}
          />
        </div>
      </div>
    </section>
  );
}
