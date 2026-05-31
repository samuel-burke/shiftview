type IconProps = { size?: number; color?: string };

export function SunriseIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
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
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
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
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
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
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M8 5.5V8l1.5 1.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimeOffApprovedIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 8.5l2 2 3-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TimeOffDeniedIcon({ size = 14, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke={color} strokeWidth="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
