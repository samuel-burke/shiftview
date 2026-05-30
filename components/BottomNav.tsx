"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Props = {
  active: "team" | "schedule" | "clock";
};

export default function BottomNav({ active }: Props) {
  const searchParams = useSearchParams();
  const demo = searchParams.get("demo") === "true" ? "?demo=true" : "";
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-slate-800 max-w-[480px] mx-auto"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
        <Link
          href={`/${demo}`}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 ${active === "team" ? "text-slate-100" : "text-slate-400"}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="15" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 20c0-3.866 2.686-7 6-7h6c3.314 0 6 3.134 6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Team</span>
          <div className={`h-[2px] w-5 rounded-full mt-0.5 ${active === "team" ? "bg-indigo-500" : "bg-transparent"}`} />
        </Link>
        <Link
          href={`/schedule${demo}`}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 ${active === "schedule" ? "text-slate-100" : "text-slate-400"}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Schedule</span>
          <div className={`h-[2px] w-5 rounded-full mt-0.5 ${active === "schedule" ? "bg-indigo-500" : "bg-transparent"}`} />
        </Link>
        <Link
          href={`/clock${demo}`}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 ${active === "clock" ? "text-slate-100" : "text-slate-400"}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Clock</span>
          <div className={`h-[2px] w-5 rounded-full mt-0.5 ${active === "clock" ? "bg-indigo-500" : "bg-transparent"}`} />
        </Link>
      </div>
    </nav>
  );
}
