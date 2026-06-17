// Pure validation/normalization for employee contact details: a personal phone
// and an emergency contact. All fields are optional; empty/whitespace clears to
// null. Phone validation is intentionally lenient (international formats vary):
// allow common punctuation and require at least 7 digits.

const NAME_MAX = 80;
const PHONE_MAX = 30;
const PHONE_ALLOWED = /^[+()\d\s.-]+$/;

export type ContactInput = {
  phone?: unknown;
  emergencyContactName?: unknown;
  emergencyContactPhone?: unknown;
};

export type ContactValue = {
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

export type ContactResult =
  | { valid: true; value: ContactValue }
  | { valid: false; error: string };

function normName(v: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} must be a string` };
  const t = v.trim();
  if (!t) return { ok: true, value: null };
  if (t.length > NAME_MAX) return { ok: false, error: `${label} must be ${NAME_MAX} characters or fewer` };
  return { ok: true, value: t };
}

function normPhone(v: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} must be a string` };
  const t = v.trim();
  if (!t) return { ok: true, value: null };
  if (t.length > PHONE_MAX) return { ok: false, error: `${label} must be ${PHONE_MAX} characters or fewer` };
  if (!PHONE_ALLOWED.test(t)) return { ok: false, error: `${label} contains invalid characters` };
  const digits = (t.match(/\d/g) ?? []).length;
  if (digits < 7) return { ok: false, error: `${label} must have at least 7 digits` };
  return { ok: true, value: t };
}

export function validateContactInfo(input: ContactInput): ContactResult {
  const phone = normPhone(input.phone, "Phone");
  if (!phone.ok) return { valid: false, error: phone.error };
  const name = normName(input.emergencyContactName, "Emergency contact name");
  if (!name.ok) return { valid: false, error: name.error };
  const ephone = normPhone(input.emergencyContactPhone, "Emergency contact phone");
  if (!ephone.ok) return { valid: false, error: ephone.error };

  return {
    valid: true,
    value: {
      phone: phone.value,
      emergencyContactName: name.value,
      emergencyContactPhone: ephone.value,
    },
  };
}
