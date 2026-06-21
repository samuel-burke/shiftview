"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { getMonogram } from "../../data/types";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import { motion } from "framer-motion";
import { useAppData } from "../../lib/AppDataContext";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

type Employee = { id: number; name: string; email: string | null; user_id: string | null };

export default function AdminPageClient({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { me } = useAppData();
  const isDemo = me.isDemo;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [managerUserIds, setManagerUserIds] = useState<Set<string>>(new Set());
  const [ownerUserIds, setOwnerUserIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [errorId, setErrorId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-dismiss the inline error after 5s, clearing any pending timer first so
  // the timeout can't fire (and setState) after the component unmounts.
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashError(id: number, msg: string) {
    setErrorId(id);
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => { setErrorId(null); setErrorMsg(null); }, 5000);
  }
  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/employees").then((r) => r.ok ? r.json() : Promise.reject()),
      fetch("/api/managers").then((r) => r.ok ? r.json() : Promise.reject()),
    ])
      .then(([emps, { managerUserIds: ids, ownerUserIds: ownerIds }]) => {
        setEmployees(emps);
        setManagerUserIds(new Set(ids));
        setOwnerUserIds(new Set(ownerIds ?? []));
      })
      .catch(() => {});
  }, []);

  // Supabase Realtime — live updates for employees and manager roles
  useEffect(() => {
    function refetchEmployees() {
      fetch("/api/employees")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((emps: Employee[]) => setEmployees(emps))
        .catch(() => {});
    }

    function refetchManagers() {
      fetch("/api/managers")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then(({ managerUserIds: ids, ownerUserIds: ownerIds }: { managerUserIds: string[]; ownerUserIds?: string[] }) => {
          setManagerUserIds(new Set(ids));
          setOwnerUserIds(new Set(ownerIds ?? []));
        })
        .catch(() => {});
    }

    const channel = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refetchEmployees)
      .on("postgres_changes", { event: "*", schema: "public", table: "managers" }, refetchManagers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function toggleRole(emp: Employee) {
    if (!emp.user_id) return;
    const isMgr = managerUserIds.has(emp.user_id);
    const action = isMgr ? "demote" : "promote";

    setTogglingId(emp.id);
    setErrorId(null);
    setErrorMsg(null);
    setManagerUserIds((prev) => {
      const next = new Set(prev);
      if (isMgr) next.delete(emp.user_id!);
      else next.add(emp.user_id!);
      return next;
    });

    let res: Response;
    try {
      res = await fetch(`/api/managers/${emp.user_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      setTogglingId(null);
      setManagerUserIds((prev) => {
        const next = new Set(prev);
        if (isMgr) next.add(emp.user_id!);
        else next.delete(emp.user_id!);
        return next;
      });
      flashError(emp.id, "Network error — could not reach the server.");
      return;
    }

    setTogglingId(null);

    if (!res.ok) {
      setManagerUserIds((prev) => {
        const next = new Set(prev);
        if (isMgr) next.add(emp.user_id!);
        else next.delete(emp.user_id!);
        return next;
      });
      const json = await res.json().catch(() => ({}));
      const msg = json.error ?? "Something went wrong. Please try again.";
      flashError(emp.id, msg);
    }
  }

  // Owner policy: in orgs with an owner, only the owner can change roles.
  // Ownerless orgs (predating the sign-up flow) keep the any-manager behavior.
  const canManageRoles = ownerUserIds.size === 0 || ownerUserIds.has(currentUserId);

  return (
    <AppShell active="admin" isManager>
    <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:pb-0">
      {isDemo && (
        <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Sample data resets nightly</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}
      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg
                   [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-[14px] [@media(min-width:900px)]:pb-[14px] [@media(min-width:900px)]:gap-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={() => router.back()}
          className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors [@media(min-width:900px)]:hidden"
          aria-label="Back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="text-2xl font-extrabold text-slate-100 tracking-tight [@media(min-width:900px)]:text-xl">Admin</span>
      </div>

      <div className="px-4 pt-5 [@media(min-width:900px)]:max-w-2xl [@media(min-width:900px)]:mx-auto [@media(min-width:900px)]:px-6 flex flex-col gap-5">
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Roles
          </div>

          {errorMsg && (
            <div role="alert" className="mb-3 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          <motion.div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60" variants={listContainer} initial="hidden" animate="show">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
            ) : (
              employees.map((emp) => {
                const isSelf = emp.user_id === currentUserId;
                const isMgr = emp.user_id ? managerUserIds.has(emp.user_id) : false;
                const isOwner = emp.user_id ? ownerUserIds.has(emp.user_id) : false;
                const isToggling = togglingId === emp.id;
                const hasError = errorId === emp.id;

                return (
                  <motion.div key={emp.id} variants={listItem} className="flex items-center gap-3 px-4 py-3">
                    <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200 truncate" title={emp.name}>{emp.name}</div>
                      {emp.email && <div className="text-xs text-slate-500 truncate" title={emp.email}>{emp.email}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-semibold py-1.5 rounded-lg w-20 text-center border ${
                        isOwner
                          ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
                          : isMgr
                          ? "bg-violet-500/15 text-violet-300 border-violet-500/25"
                          : "bg-slate-700/60 text-slate-400 border-slate-700"
                      }`}>
                        {isOwner ? "Owner" : isMgr ? "Manager" : "Employee"}
                      </span>
                      {!emp.user_id ? (
                        <span className="text-xs text-slate-500 w-20 py-1.5 text-center">No account</span>
                      ) : isSelf ? (
                        <span
                          className="text-xs text-slate-500 w-20 py-1.5 text-center"
                          aria-label="You — cannot change your own role"
                        >
                          You
                        </span>
                      ) : isOwner || !canManageRoles ? (
                        <span
                          className="text-xs text-slate-600 w-20 py-1.5 text-center"
                          aria-label={isOwner
                            ? "Organization owner — cannot be demoted"
                            : "Only the organization owner can change roles"}
                        >
                          —
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleRole(emp)}
                          disabled={isToggling}
                          aria-busy={isToggling}
                          className={`text-xs font-semibold py-3 rounded-lg border transition-colors cursor-pointer w-20 text-center disabled:opacity-50 disabled:cursor-not-allowed ${
                            hasError
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : isMgr
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25"
                              : "bg-indigo-500/15 text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/25"
                          }`}
                          aria-label={isMgr ? `Demote ${emp.name}` : `Promote ${emp.name}`}
                        >
                          {hasError ? "Error" : isToggling ? "…" : isMgr ? "Demote" : "Promote"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        </section>
      </div>

      <BottomNav active="admin" />
    </main>
    </AppShell>
  );
}
