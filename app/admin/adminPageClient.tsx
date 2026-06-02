"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMonogram } from "../../data/types";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import { useIsDesktop } from "../../hooks/useIsDesktop";

type Employee = { id: number; name: string; email: string | null; user_id: string | null };

const DEMO_EMPLOYEES: Employee[] = [
  { id: 1, name: "Alice Smith",  email: "alice@example.com", user_id: "demo-manager" },
  { id: 2, name: "Bob Jones",    email: "bob@example.com",   user_id: "demo-bob" },
  { id: 3, name: "Carol White",  email: "carol@example.com", user_id: null },
];
const DEMO_MANAGER_IDS = new Set(["demo-manager", "demo-bob"]);

export default function AdminPageClient({
  currentUserId,
  isDemo = false,
}: {
  currentUserId: string;
  isDemo?: boolean;
}) {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [managerUserIds, setManagerUserIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [errorId, setErrorId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      setEmployees(DEMO_EMPLOYEES);
      setManagerUserIds(new Set(DEMO_MANAGER_IDS));
      return;
    }
    Promise.all([
      fetch("/api/employees").then((r) => r.ok ? r.json() : Promise.reject()),
      fetch("/api/managers").then((r) => r.ok ? r.json() : Promise.reject()),
    ])
      .then(([emps, { managerUserIds: ids }]) => {
        setEmployees(emps);
        setManagerUserIds(new Set(ids));
      })
      .catch(() => {});
  }, [isDemo]);

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

    if (isDemo) {
      await new Promise((r) => setTimeout(r, 400));
      setTogglingId(null);
      return;
    }

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
      setErrorId(emp.id);
      setErrorMsg("Network error — could not reach the server.");
      setTimeout(() => { setErrorId(null); setErrorMsg(null); }, 5000);
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
      setErrorId(emp.id);
      setErrorMsg(msg);
      setTimeout(() => { setErrorId(null); setErrorMsg(null); }, 5000);
    }
  }

  const isDesktop = useIsDesktop();

  return (
    <AppShell active="admin" isManager>
    <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto pb-28 bg-bg min-h-screen"}`}>
      {isDesktop ? (
        <div className="border-b border-slate-800 px-6 py-[14px]">
          <span className="text-xl font-extrabold text-slate-100 tracking-tight">Admin</span>
        </div>
      ) : (
        <div
          className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center text-xl cursor-pointer shrink-0"
            aria-label="Back"
          >
            ‹
          </button>
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">Admin</span>
        </div>
      )}

      <div className={`${isDesktop ? "max-w-2xl mx-auto px-6 pt-5" : "px-4 pt-5"} flex flex-col gap-5`}>
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Roles
          </div>

          {errorMsg && (
            <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
            ) : (
              employees.map((emp) => {
                const isSelf = emp.user_id === currentUserId;
                const isMgr = emp.user_id ? managerUserIds.has(emp.user_id) : false;
                const isToggling = togglingId === emp.id;
                const hasError = errorId === emp.id;

                return (
                  <div key={emp.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="size-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200 truncate">{emp.name}</div>
                      {emp.email && <div className="text-xs text-slate-500 truncate">{emp.email}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-semibold py-1.5 rounded-lg w-20 text-center border ${
                        isMgr
                          ? "bg-violet-500/15 text-violet-300 border-violet-500/25"
                          : "bg-slate-700/60 text-slate-400 border-slate-700"
                      }`}>
                        {isMgr ? "Manager" : "Employee"}
                      </span>
                      {!emp.user_id ? (
                        <span className="text-xs text-slate-600 w-20 py-1.5 text-center">No account</span>
                      ) : isSelf ? (
                        <span
                          className="text-xs text-slate-600 w-20 py-1.5 text-center"
                          title="You cannot change your own role"
                        >
                          You
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleRole(emp)}
                          disabled={isToggling}
                          className={`text-xs font-semibold py-1.5 rounded-lg border transition-colors cursor-pointer w-20 text-center ${
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
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {!isDesktop && <BottomNav active="admin" />}
    </main>
    </AppShell>
  );
}
