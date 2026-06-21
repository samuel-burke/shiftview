"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useAppData } from "../../lib/AppDataContext";
import {
  CoverageBlock,
  CoverageDefaults,
  CoverageProfile,
  curveHours,
  validateBlocks,
} from "../../lib/coverage";
import AppShell from "../../components/AppShell";
import BottomNav from "../../components/BottomNav";
import CoverageCurveEditor, { CoverageCurvePreview } from "../../components/CoverageCurveEditor";
import { createApiFetch } from "@/lib/api-fetch";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type EditingState = {
  id: number | null; // null = creating a new profile
  name: string;
  blocks: CoverageBlock[];
};

export default function CoveragePageClient() {
  const router = useRouter();
  const apiFetch = createApiFetch(() => router.push("/login"));

  const { me, sharedLoading } = useAppData();
  const { isManager } = me;

  const [profiles, setProfiles] = useState<CoverageProfile[]>([]);
  const [defaults, setDefaults] = useState<CoverageDefaults>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [savingDefaultDow, setSavingDefaultDow] = useState<number | null>(null);

  async function fetchAll() {
    const [profilesRes, assignmentsRes] = await Promise.all([
      apiFetch("/api/coverage-profiles"),
      apiFetch("/api/coverage-assignments"),
    ]);
    if (!profilesRes.ok || !assignmentsRes.ok) throw new Error("Failed to load coverage data");
    const profilesData = await profilesRes.json();
    const assignments = await assignmentsRes.json();
    return {
      profiles: Array.isArray(profilesData) ? (profilesData as CoverageProfile[]) : [],
      defaults: (assignments?.defaults ?? {}) as CoverageDefaults,
    };
  }

  useEffect(() => {
    if (!isManager) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchAll()
      .then((data) => {
        if (cancelled) return;
        setProfiles(data.profiles);
        setDefaults(data.defaults);
      })
      .catch(() => { if (!cancelled) setMigrationRequired(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  async function handleSaveProfile() {
    if (!editing) return;
    if (!editing.name.trim()) { setEditError("Profile name is required."); return; }
    const blocksError = validateBlocks(editing.blocks);
    if (blocksError) { setEditError(blocksError); return; }

    setSaving(true);
    setEditError(null);
    try {
      const res = await apiFetch("/api/coverage-profiles", {
        method: editing.id === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing.id === null
            ? { name: editing.name.trim(), blocks: editing.blocks }
            : { id: editing.id, name: editing.name.trim(), blocks: editing.blocks }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save profile");
      }
      const data = await fetchAll();
      setProfiles(data.profiles);
      setDefaults(data.defaults);
      setEditing(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProfile(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/coverage-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete profile");
      }
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      setDefaults((prev) => Object.fromEntries(
        Object.entries(prev).map(([dow, pid]) => [dow, pid === id ? null : pid])
      ));
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(dow: number, profileId: number | null) {
    setSavingDefaultDow(dow);
    setError(null);
    const previous = defaults[dow] ?? null;
    setDefaults((prev) => ({ ...prev, [dow]: profileId }));
    try {
      const res = await apiFetch("/api/coverage-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek: dow, profileId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save default");
      }
    } catch (e) {
      setDefaults((prev) => ({ ...prev, [dow]: previous }));
      setError(e instanceof Error ? e.message : "Failed to save default");
    } finally {
      setSavingDefaultDow(null);
    }
  }

  if (!sharedLoading && !isManager) {
    return (
      <AppShell active="settings" isManager={isManager}>
        <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen flex flex-col items-center justify-center px-6 text-center [@media(min-width:900px)]:max-w-none">
          <div className="text-4xl mb-3" aria-hidden="true">📈</div>
          <h1 className="text-lg font-bold text-slate-100 mb-1.5">Coverage Profiles</h1>
          <p className="text-sm text-slate-400">Only managers can manage coverage profiles.</p>
          <BottomNav active="settings" />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell active="settings" isManager={isManager}>
      <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:pb-8">
        {/* Header */}
        <div
          className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg
                     [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-[14px] [@media(min-width:900px)]:pb-[14px]"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors [@media(min-width:900px)]:hidden"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-xl font-extrabold text-slate-100 tracking-tight">Coverage Profiles</span>
            <div className="text-xs text-slate-400 mt-0.5">Target staffing curves, in 15-minute steps</div>
          </div>
        </div>

        {migrationRequired && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-400 [@media(min-width:900px)]:mx-6">
            Coverage tables are missing. Run <code className="font-mono">db/migrations/2026-06-10-coverage-profiles.sql</code> in the Supabase SQL editor.
          </div>
        )}
        {error && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center [@media(min-width:900px)]:mx-6">
            {error}
          </div>
        )}

        <div className="px-4 pt-5 flex flex-col gap-6 [@media(min-width:900px)]:max-w-2xl [@media(min-width:900px)]:mx-auto [@media(min-width:900px)]:px-6">
          {/* Profiles */}
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Profiles</span>
              {!editing && (
                <button
                  onClick={() => { setEditing({ id: null, name: "", blocks: [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }] }); setEditError(null); }}
                  className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer transition-colors"
                >
                  + New Profile
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* New profile editor */}
                <AnimatePresence>
                  {editing && editing.id === null && (
                    <ProfileEditorCard
                      editing={editing}
                      setEditing={setEditing}
                      onSave={handleSaveProfile}
                      onCancel={() => { setEditing(null); setEditError(null); }}
                      saving={saving}
                      error={editError}
                    />
                  )}
                </AnimatePresence>

                {profiles.length === 0 && !editing && (
                  <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-6 text-center text-sm text-slate-500">
                    No coverage profiles yet. Create one to set staffing targets.
                  </div>
                )}

                {profiles.map((p) =>
                  editing?.id === p.id ? (
                    <ProfileEditorCard
                      key={p.id}
                      editing={editing}
                      setEditing={setEditing}
                      onSave={handleSaveProfile}
                      onCancel={() => { setEditing(null); setEditError(null); }}
                      saving={saving}
                      error={editError}
                    />
                  ) : (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-card rounded-2xl border border-slate-800/60 px-4 pt-3 pb-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-100 truncate">{p.name}</div>
                          <div className="text-[11px] text-indigo-400 font-semibold tabular-nums">
                            {Math.round(curveHours(p.blocks) * 10) / 10} staff-hrs / day
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {confirmDeleteId === p.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteProfile(p.id)}
                                disabled={saving}
                                className="text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs font-semibold text-slate-400 bg-transparent border-none cursor-pointer hover:text-slate-200 transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => { setEditing({ id: p.id, name: p.name, blocks: p.blocks.map((b) => ({ ...b })) }); setEditError(null); setConfirmDeleteId(null); }}
                                className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-indigo-500/20 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(p.id)}
                                className="text-xs font-semibold text-slate-500 bg-transparent border-none cursor-pointer hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <CoverageCurvePreview blocks={p.blocks} height={90} />
                    </motion.div>
                  )
                )}
              </div>
            )}
          </section>

          {/* Weekly defaults */}
          <section>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Weekly Defaults
            </div>
            <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
              {DAY_NAMES.map((dayName, dow) => (
                <div key={dow} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-300 w-24 shrink-0">{dayName}</span>
                  <select
                    value={defaults[dow] ?? ""}
                    disabled={loading || savingDefaultDow === dow}
                    aria-label={`Default coverage profile for ${dayName}`}
                    onChange={(e) => handleSetDefault(dow, e.target.value === "" ? null : Number(e.target.value))}
                    className="flex-1 min-w-0 bg-bg border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/70 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <option value="">No coverage target</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2 px-1">
              Specific dates (holidays, events) can be overridden from the draft schedule planner.
            </p>
          </section>
        </div>

        <BottomNav active="settings" />
      </main>
    </AppShell>
  );
}

function ProfileEditorCard({
  editing,
  setEditing,
  onSave,
  onCancel,
  saving,
  error,
}: {
  editing: EditingState;
  setEditing: (e: EditingState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="bg-card rounded-2xl border border-indigo-500/30 px-4 pt-4 pb-4"
    >
      <label htmlFor="profile-name" className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5 block">
        Profile Name
      </label>
      <input
        id="profile-name"
        type="text"
        value={editing.name}
        maxLength={60}
        placeholder="e.g. Weekday, Saturday, Holiday"
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        className="w-full bg-bg border border-slate-700 rounded-[10px] px-[14px] py-3 text-slate-100 text-sm mb-4 focus:outline-none focus:border-indigo-500/70 transition-colors"
      />

      <CoverageCurveEditor
        blocks={editing.blocks}
        onChange={(blocks) => setEditing({ ...editing, blocks })}
      />

      {error && (
        <div role="alert" className="text-xs text-red-400 text-center mt-3">{error}</div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          onClick={onSave}
          disabled={saving}
          aria-busy={saving}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all"
        >
          {saving ? "Saving…" : editing.id === null ? "Create Profile" : "Save Profile"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-3 rounded-xl bg-transparent border border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
