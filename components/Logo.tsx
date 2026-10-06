import { useId } from "react";
import BetaBadge from "@/components/BetaBadge";

/*
 * ShiftView logo. Source files and usage live in docs/brand.
 *
 * The mark is an S drawn as one continuous shift timeline (opener, mid, closer)
 * with the green "live" dot the app uses for whoever is on the floor right now.
 * Strokes are 17 units on a 14-unit grid inside a 73-unit square.
 *
 * The wordmark is Inter Display Bold at -0.025em, outlined to a path with round
 * i-dots that echo the live dot. Outlining keeps it identical on devices where
 * Inter isn't loaded, and it fills with currentColor so it follows the theme.
 */
const MARK_PATH = "M54 22H36C25.92 22 22 25.92 22 36C22 46.08 25.92 50 36 50H64C74.08 50 78 53.92 78 64C78 74.08 74.08 78 64 78H22";
const WORDMARK_PATH =
  "M115.17 63.42C128.02 63.42 135.86 57.22 135.86 47.17C135.86 39.34 130.93 34.75 119.8 32.41L114.79 31.32C108.38 29.92 105.8 28.13 105.8 24.91C105.8 21.1 109.54 18.44 114.86 18.44C120.46 18.44 124.13 21.48 124.52 26.42H134.6C134.28 15.92 126.83 9.59 114.83 9.59C102.96 9.59 95.02 15.95 95.02 25.44C95.02 32.89 100.02 37.69 110.34 39.93L115.84 41.12C122.45 42.55 125.19 44.52 125.19 47.88C125.19 51.94 121.23 54.56 115.25 54.56C108.56 54.56 104.53 51.2 104.39 45.46H94C94 56.8 101.8 63.42 115.17 63.42ZM150.48 42.03C150.48 36.29 153.46 33.73 157.73 33.73C162.03 33.73 164.52 36.36 164.52 41.33V62.58H174.81V39.44C174.81 30.09 169.73 24.84 161.86 24.84C156.64 24.84 152.97 27.12 150.48 31.18V10.42H140.16V62.58H150.48ZM180.33 62.58H190.66V25.62H180.33ZM191.36 15.22C191.36 11.97 188.72 9.34 185.48 9.34C182.23 9.34 179.6 11.97 179.6 15.22C179.6 18.47 182.23 21.1 185.48 21.1C188.72 21.1 191.36 18.47 191.36 15.22ZM217.67 25.62H210.11V22.57C210.11 19.63 211.19 18.51 214.17 18.51H217.67V10.42H211.82C203.84 10.42 199.82 13.92 199.82 20.82V25.62H193.13V33.7H199.82V62.58H210.11V33.7H217.67ZM239.15 25.62H231.59V15.53H221.27V25.62H214.9V33.7H221.27V52.78C221.27 59.5 225.01 62.58 233.13 62.58H239.15V54.49H235.2C232.4 54.49 231.59 53.69 231.59 51.16V33.7H239.15ZM257.21 62.58H270.93L288.85 10.42H277.26L269.11 35.8C267.6 40.77 265.99 46.37 264.17 52.78C262.28 46.37 260.64 40.77 259.06 35.8L250.63 10.42H238.9ZM291.01 62.58H301.33V25.62H291.01ZM302.03 15.22C302.03 11.97 299.4 9.34 296.15 9.34C292.91 9.34 290.27 11.97 290.27 15.22C290.27 18.47 292.91 21.1 296.15 21.1C299.4 21.1 302.03 18.47 302.03 15.22ZM323.69 63.42C332.65 63.42 339.79 58.3 341.16 50.95H331.74C330.8 53.83 328.03 55.68 324.01 55.68C318.58 55.68 315.43 52.15 315.26 46.69H341.54V43.92C341.54 32.65 334.23 24.77 323.34 24.77C312.74 24.77 305.21 32.86 305.21 44.13C305.21 55.37 312.49 63.42 323.69 63.42ZM315.33 40.11C315.89 35.48 318.93 32.61 323.55 32.61C328.21 32.61 331.29 35.48 331.81 40.11ZM352.45 62.58H363.06L367.4 47.88C368.31 44.76 369.15 41.47 369.99 38.18C370.83 41.47 371.67 44.76 372.54 47.88L376.85 62.58H387.52L398.9 25.62H387.94L384.58 38.53C383.5 42.91 382.52 47.56 381.5 52.15C380.42 47.56 379.3 42.87 378.14 38.53L374.64 25.62H365.33L361.8 38.53C360.64 42.91 359.52 47.59 358.4 52.18C357.39 47.59 356.37 42.91 355.25 38.53L351.86 25.62H341.08Z";

// useId per instance: a gradient referenced from another SVG stops painting
// once that SVG is display:none (e.g. the header logo at the wide size class).
function MarkShapes({ gradientId }: { gradientId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="13.5" y1="13.5" x2="86.5" y2="86.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d={MARK_PATH} stroke={`url(#${gradientId})`} strokeWidth="17" strokeLinecap="round" />
      <circle cx="78" cy="22" r="8.5" fill="#22c55e" />
    </>
  );
}

/** The S mark on its own, for tight spots like the nav rail. Decorative unless labelled. */
export function LogoMark({ className = "", label }: { className?: string; label?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="13.5 13.5 73 73"
      fill="none"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <MarkShapes gradientId={`${id}mark`} />
    </svg>
  );
}

/** Mark + wordmark + beta pill. Size it with a height class (width follows). */
export default function Logo({ className = "h-6" }: { className?: string }) {
  const id = useId();
  return (
    <span className="inline-flex items-center whitespace-nowrap text-slate-100">
      <svg viewBox="0 0 398.9 73" fill="none" role="img" aria-label="ShiftView" className={`w-auto shrink-0 ${className}`}>
        <g transform="translate(-13.5 -13.5)">
          <MarkShapes gradientId={`${id}mark`} />
        </g>
        <path d={WORDMARK_PATH} fill="currentColor" />
      </svg>
      <BetaBadge />
    </span>
  );
}
