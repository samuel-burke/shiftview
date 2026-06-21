// Pure validation for employee skills/capabilities (Keyholder, Barista, Forklift
// certified, …). Distinct from positions (a role on a specific shift) and
// certifications (credentials with expiry): a skill is a durable capability,
// most useful for the reverse lookup "who can do X?" when filling a gap.

export const SKILL_NAME_MAX = 40;

export type SkillResult = { valid: true; value: string } | { valid: false; error: string };

export function validateSkillName(name: unknown): SkillResult {
  if (typeof name !== "string" || !name.trim())
    return { valid: false, error: "Skill name is required" };
  const value = name.trim();
  if (value.length > SKILL_NAME_MAX)
    return { valid: false, error: `Skill must be ${SKILL_NAME_MAX} characters or fewer` };
  return { valid: true, value };
}
