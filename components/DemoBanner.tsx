// The demo strip ("Demo Mode · Sample data resets nightly"). It's always in
// the page and shown by CSS while <html> has data-demo, which is set before the
// first paint from the cached identity (app/layout.tsx) and kept in sync by
// lib/AppDataContext.tsx — so it is there from the first frame, rather than
// arriving with /api/me and pushing the whole screen down.
export default function DemoBanner({
  className = "flex",
  style,
}: {
  /** Display and placement for the strip itself, e.g. "hidden desk:flex". */
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="demo-only">
      <div
        className={`bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 items-center justify-between ${className}`}
        style={style}
      >
        <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Sample data resets nightly</span>
        <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
      </div>
    </div>
  );
}
