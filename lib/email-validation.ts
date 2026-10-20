export const MAX_EMAIL_LENGTH = 254;

// Keep the existing basic format check, with bounded input and linear scans
// instead of overlapping regex repetitions over the domain.
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(value)) return false;

  const at = value.indexOf("@");
  if (at <= 0 || value.indexOf("@", at + 1) !== -1) return false;

  // The domain needs a character on either side of a dot.
  const dot = value.indexOf(".", at + 2);
  return dot !== -1 && dot < value.length - 1;
}
