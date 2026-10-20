"use client";

import { useState } from "react";

// Manager-only, under each employee in Settings → Team: whether they're
// exempt (salaried). Payroll pays an exempt employee's hours as regular time,
// with no overtime under any rule.
export default function EmployeeExemptToggle({
  employee,
  onSaved,
}: {
  employee: { id: number; name: string; exempt?: boolean | null };
  onSaved: (exempt: boolean) => void;
}) {
  const exempt = employee.exempt === true;
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setProblem(null);
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: employee.id, exempt: !exempt }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) onSaved(!exempt);
    else setProblem("Couldn't save. Try again.");
  }

  return (
    <div data-testid={`employee-exempt-${employee.id}`} className="px-4 pb-3 pt-0 flex items-center justify-between gap-3">
      <div className="min-w-0 text-xs text-fg-subtle">
        <span className="font-semibold text-fg-secondary">Exempt (salaried)</span>
        {" · "}
        {exempt ? "no overtime is calculated" : "paid overtime by the store's rule"}
        {problem && <span role="alert" className="block text-danger-fg">{problem}</span>}
      </div>
      <button
        role="switch"
        aria-label={`Exempt from overtime: ${employee.name}`}
        aria-checked={exempt}
        disabled={saving}
        onClick={toggle}
        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
          exempt ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${exempt ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}
