export function validateShiftMinutes(startMinutes: unknown, endMinutes: unknown): string | null {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes))
    return "startMinutes and endMinutes must be integers";
  const start = startMinutes as number;
  const end   = endMinutes   as number;
  if (start < 0 || start >= 1440)  return "startMinutes must be between 0 and 1439";
  if (end   <= 0 || end   > 1440)  return "endMinutes must be between 1 and 1440";
  if (start >= end)                 return "startMinutes must be less than endMinutes";
  if (end - start < 60)            return "shift must be at least 1 hour";
  if (end - start > 960)           return "shift cannot exceed 16 hours";
  return null;
}
