// Layout and button styles shared by the public marketing pages.

export const REPO_URL = "https://github.com/samuel-burke/shiftview";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

// The app's primary action: its blue-to-violet gradient.
export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white hover:brightness-110 transition-[filter]";
export const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100 transition-colors cursor-pointer";

export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A section's heading and one-line description. */
export function SectionHeading({ eyebrow, title, body, className = "" }: { eyebrow?: React.ReactNode; title: string; body: string; className?: string }) {
  return (
    <div className={`max-w-2xl ${className}`}>
      {eyebrow && <p className="mb-4 flex items-center gap-2 text-sm font-medium text-blue-400">{eyebrow}</p>}
      <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-[2.75rem]">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">{body}</p>
    </div>
  );
}
