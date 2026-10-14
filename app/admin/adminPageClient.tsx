"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { getMonogram } from "../../data/types";
import BottomNav from "../../components/BottomNav";
import { Toast, ToastStack } from "@/components/Toast";
import AppShell from "../../components/AppShell";
import HeaderActions from "../../components/HeaderActions";
import { motion } from "framer-motion";
import DemoBanner from "@/components/DemoBanner";

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

  // Loaded independently: a failed role lookup must not hide the roster.
  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((emps: Employee[]) => setEmployees(emps))
      .catch(() => {});
    fetch("/api/managers")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(({ managerUserIds: ids, ownerUserIds: ownerIds }: { managerUserIds: string[]; ownerUserIds?: string[] }) => {
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
    <main className="max-w-[480px] mx-auto tablet:max-w-[760px] tablet:pb-10 pb-28 bg-bg min-h-dvh desk:max-w-none desk:pb-0">
      <DemoBanner />
      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-line bg-bg
                   desk:px-6 desk:py-[14px] desk:pb-[14px] desk:gap-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={() => router.back()}
          className="size-11 rounded-xl bg-card border border-line text-fg-muted flex items-center justify-center cursor-pointer shrink-0 hover:bg-fill hover:text-fg-body transition-colors tablet:hidden"
          aria-label="Back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="flex-1 text-2xl font-extrabold text-fg tracking-tight desk:text-xl">Admin</span>
        <HeaderActions className="hidden tablet:flex" />
      </div>

      <div className="px-4 pt-5 desk:max-w-2xl desk:mx-auto desk:px-6 flex flex-col gap-5">
        <section>
          <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">
            Roles
          </div>

          {/* Over the page, so it can't push the roles list down. */}
          <ToastStack>
            {errorMsg && <Toast>{errorMsg}</Toast>}
          </ToastStack>

          <motion.div className="bg-card rounded-2xl border border-line/60 overflow-hidden divide-y divide-line/60" variants={listContainer} initial="hidden" animate="show">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-fg-subtle">No employees</div>
            ) : (
              employees.map((emp) => {
                const isSelf = emp.user_id === currentUserId;
                const isMgr = emp.user_id ? managerUserIds.has(emp.user_id) : false;
                const isOwner = emp.user_id ? ownerUserIds.has(emp.user_id) : false;
                const isToggling = togglingId === emp.id;
                const hasError = errorId === emp.id;

                return (
                  <motion.div key={emp.id} variants={listItem} className="flex items-center gap-3 px-4 py-3">
                    <div className="size-9 rounded-full bg-accent-solid/90 border border-accent/30 flex items-center justify-center text-xs font-bold text-on-accent shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* The role is a tag on the person, in the app's tag style (small,
                          rounded, no border), so it doesn't read as a button beside
                          Promote / Demote. */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-fg-body truncate" title={emp.name}>{emp.name}</span>
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                          isOwner
                            ? "bg-warning/15 text-warning-fg-strong"
                            : isMgr
                            ? "bg-auto/15 text-auto-fg-strong"
                            : "bg-fill text-fg-muted"
                        }`}>
                          {isOwner ? "Owner" : isMgr ? "Manager" : "Employee"}
                        </span>
                      </div>
                      {emp.email && <div className="text-xs text-fg-subtle truncate" title={emp.email}>{emp.email}</div>}
                    </div>
                    {/* The action column has a fixed width so buttons line up row to row. */}
                    <div className="flex items-center shrink-0">
                      {!emp.user_id ? (
                        <span className="text-xs text-fg-subtle w-20 py-1.5 text-center">No account</span>
                      ) : isSelf ? (
                        <span
                          className="text-xs text-fg-subtle w-20 py-1.5 text-center"
                          aria-label="You — cannot change your own role"
                        >
                          You
                        </span>
                      ) : isOwner || !canManageRoles ? (
                        <span
                          className="text-xs text-fg-subtle w-20 py-1.5 text-center"
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
                              ? "bg-danger/20 text-danger-fg border-danger/30"
                              : isMgr
                              ? "bg-warning/15 text-warning-fg border-warning/25 hover:bg-warning/25"
                              : "bg-accent/15 text-accent-fg border-accent/25 hover:bg-accent/25"
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
