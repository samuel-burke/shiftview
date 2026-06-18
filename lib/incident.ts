// Pure validation for a workplace incident/injury report (slip, burn, near-miss,
// …). Any staff member can file one; the records are sensitive, so reading is
// manager-only (enforced by RLS + the API).

export const INCIDENT_SEVERITIES = ["minor", "moderate", "severe"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DESCRIPTION_MAX = 2000;

export type IncidentResult =
  | { valid: true; value: { date: string; severity: IncidentSeverity; description: string } }
  | { valid: false; error: string };

export function validateIncident(input: {
  date?: unknown;
  severity?: unknown;
  description?: unknown;
}): IncidentResult {
  if (typeof input.date !== "string" || !DATE_RE.test(input.date))
    return { valid: false, error: "date must be YYYY-MM-DD" };
  if (!INCIDENT_SEVERITIES.includes(input.severity as IncidentSeverity))
    return { valid: false, error: "severity must be minor, moderate, or severe" };
  if (typeof input.description !== "string" || !input.description.trim())
    return { valid: false, error: "description is required" };
  const description = input.description.trim();
  if (description.length > DESCRIPTION_MAX)
    return { valid: false, error: `description must be ${DESCRIPTION_MAX} characters or fewer` };

  return { valid: true, value: { date: input.date, severity: input.severity as IncidentSeverity, description } };
}
