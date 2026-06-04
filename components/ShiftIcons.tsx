type IconProps = { size?: number; color?: string };

export function SunriseIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Horizon line */}
      <line x1="1" y1="10" x2="15" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {/* Half-circle sun (center at 8,10, radius 5) */}
      <path d="M3 10A5 5 0 0 1 13 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* Rays */}
      <line x1="8" y1="2" x2="8" y2="3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="4.5" x2="13" y2="3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="4.5" x2="3" y2="3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SunIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke={color} strokeWidth="1.5" />
      <line x1="8" y1="1.5" x2="8" y2="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="13" x2="8" y2="14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1.5" y1="8" x2="3" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="8" x2="14.5" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11.5" y1="11.5" x2="12.6" y2="12.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12.6" y1="3.4" x2="11.5" y2="4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4.5" y1="11.5" x2="3.4" y2="12.6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Crescent: full circle arc, then inner offset arc to cut crescent */}
      <path
        d="M14 8.5A6 6 0 1 1 7.5 2a4.5 4.5 0 0 0 6.5 6.5Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShiftIcon({ shiftType, size = 14, color = "currentColor" }: { shiftType: string; size?: number; color?: string }) {
  if (shiftType === "opener") return <SunriseIcon size={size} color={color} />;
  if (shiftType === "mid") return <SunIcon size={size} color={color} />;
  if (shiftType === "closer") return <MoonIcon size={size} color={color} />;
  return null;
}

export function TimeOffPendingIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M8 5.5V8l1.5 1.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimeOffApprovedIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 8.5l2 2 3-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimeOffDeniedIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CalendarIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke={color} strokeWidth="1.5" />
      <path d="M2 7h12" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 1.5v3M10.5 1.5v3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AlarmIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="9" r="4.5" stroke={color} strokeWidth="1.5" />
      <path d="M8 7v2l1.5 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4.5L2.5 3M12 4.5L13.5 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function WarningIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2L14.5 13H1.5L8 2Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 11v.75" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MegaphoneIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="6" width="3" height="4" rx="0.75" stroke={color} strokeWidth="1.5" />
      <path d="M4 6.5L11 3.5v9L4 9.5" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12.5 5.5a3.5 3.5 0 010 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BellIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5a4 4 0 00-4 4v2L3 10h10l-1-1.5v-2a4 4 0 00-4-4Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 10.5a1.5 1.5 0 003 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7.5" width="10" height="7" rx="1.5" stroke={color} strokeWidth="1.5" />
      <path d="M5 7.5V5a3 3 0 016 0v2.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
