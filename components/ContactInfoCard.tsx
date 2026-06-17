"use client";

import { useState } from "react";
import { validateContactInfo } from "../lib/contact-info";

export type ContactInfo = {
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

// View / edit an employee's contact + emergency contact. Presentational — the
// parent persists via PUT /api/employees/contact. Read-only when canEdit=false.
export default function ContactInfoCard({
  contact,
  canEdit = false,
  onSave,
}: {
  contact: ContactInfo;
  canEdit?: boolean;
  onSave?: (value: ContactInfo) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [ecName, setEcName] = useState(contact.emergencyContactName ?? "");
  const [ecPhone, setEcPhone] = useState(contact.emergencyContactPhone ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const check = validateContactInfo({
      phone,
      emergencyContactName: ecName,
      emergencyContactPhone: ecPhone,
    });
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setEditing(false);
    onSave?.(check.value);
  };

  if (!editing) {
    return (
      <div data-testid="contact-info-card" className="rounded-2xl bg-card border border-slate-800/60 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Contact</div>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] font-semibold text-indigo-400 cursor-pointer bg-transparent border-none hover:text-indigo-300"
            >
              Edit
            </button>
          )}
        </div>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Phone</dt>
            <dd className="text-slate-200">{contact.phone ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Emergency</dt>
            <dd className="text-slate-200">
              {contact.emergencyContactName
                ? `${contact.emergencyContactName}${contact.emergencyContactPhone ? ` · ${contact.emergencyContactPhone}` : ""}`
                : "—"}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  const field = "rounded-xl bg-bg border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600";
  return (
    <div data-testid="contact-info-edit" className="rounded-2xl bg-card border border-slate-800/60 px-4 py-3 flex flex-col gap-2">
      <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" placeholder="Phone" />
      <input className={field} value={ecName} onChange={(e) => setEcName(e.target.value)} aria-label="Emergency contact name" placeholder="Emergency contact name" />
      <input className={field} value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} aria-label="Emergency contact phone" placeholder="Emergency contact phone" />
      {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(false)} className="text-xs font-semibold text-slate-400 bg-transparent border-none cursor-pointer">Cancel</button>
        <button onClick={save} className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer border-none hover:brightness-110">Save</button>
      </div>
    </div>
  );
}
