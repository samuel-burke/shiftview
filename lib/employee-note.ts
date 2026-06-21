// Pure validation for a private manager note about an employee (coaching /
// performance log). Visibility is manager-only — enforced by RLS
// (is_org_manager) and the API — so these never reach the employee.

export const EMPLOYEE_NOTE_MAX = 2000;

export type EmployeeNoteResult =
  | { valid: true; value: string }
  | { valid: false; error: string };

export function validateEmployeeNote(body: unknown): EmployeeNoteResult {
  if (typeof body !== "string" || !body.trim())
    return { valid: false, error: "Note is required" };
  const value = body.trim();
  if (value.length > EMPLOYEE_NOTE_MAX)
    return { valid: false, error: `Note must be ${EMPLOYEE_NOTE_MAX} characters or fewer` };
  return { valid: true, value };
}
