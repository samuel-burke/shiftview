"use client";

// Device frames for the marketing previews. Each screen is laid out at the
// device's real viewport size, so the app's own components and size classes
// apply as they do on that device, then scaled down with a transform. (Not
// CSS zoom: Safari leaves rem lengths, such as Tailwind's corner radii,
// unzoomed, so every box came out too rounded.) Screen contents are inert:
// the frame's label describes the picture, and nothing inside can be focused
// or clicked.
//
// Drop shadows scale with the device. A fixed blur that is large next to a
// small box (a phone at a third of its size) is cut off with hard edges in
// Chrome on 2x and 3x screens.

import { useLayoutEffect, useRef, useState } from "react";

// An iPhone Pro Max: the app's top bar needs 430px once the bell and "Clocked In" show.
export const PHONE = { width: 430, height: 932 };
export const TABLET = { width: 820, height: 1180 };
export const DESKTOP = { width: 1440, height: 900 };

/**
 * Lays `children` out at width × height CSS px and scales them to the box's
 * width. Until it has measured (server render, first paint) it uses the
 * --screen-zoom custom property, set per breakpoint by the caller.
 */
export function Screen({
  width,
  height,
  className = "",
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setZoom(el.clientWidth / width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={box} className={`relative isolate overflow-hidden bg-bg ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div inert className="absolute left-0 top-0 origin-top-left overflow-hidden" style={{ width, height, transform: `scale(${zoom ?? "var(--screen-zoom, 0.5)"})` }}>
        {children}
      </div>
    </div>
  );
}

/**
 * A phone at a fixed size: --phone-zoom (default 0.72) scales the 430 × 932
 * screen, so callers size it with a class such as [--phone-zoom:0.62]. (The
 * default lives in var() fallbacks, not a class, so a caller's class wins.)
 */
export function PhoneFrame({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <figure aria-label={label} className={`relative isolate shrink-0 ${className}`}>
      {/* Side buttons */}
      <span aria-hidden="true" className="absolute -left-[3px] top-[18%] h-[6%] w-[3px] rounded-l-sm bg-[#1b1f2a]" />
      <span aria-hidden="true" className="absolute -left-[3px] top-[27%] h-[9%] w-[3px] rounded-l-sm bg-[#1b1f2a]" />
      <span aria-hidden="true" className="absolute -right-[3px] top-[23%] h-[12%] w-[3px] rounded-r-sm bg-[#1b1f2a]" />
      <div className="rounded-[calc(56px*var(--phone-zoom,0.72))] bg-[#05070d] p-[calc(12px*var(--phone-zoom,0.72))] shadow-[0_calc(50px*var(--phone-zoom,0.72))_calc(100px*var(--phone-zoom,0.72))_calc(-28px*var(--phone-zoom,0.72))_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <div
          className="relative overflow-hidden rounded-[calc(44px*var(--phone-zoom,0.72))] bg-bg"
          style={{ width: `calc(${PHONE.width}px * var(--phone-zoom,0.72))`, height: `calc(${PHONE.height}px * var(--phone-zoom,0.72))` }}
        >
          <div inert className="absolute left-0 top-0 origin-top-left overflow-hidden" style={{ ...PHONE, transform: "scale(var(--phone-zoom,0.72))" }}>
            {children}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** An iPad in portrait. Fills its container's width. */
export function TabletFrame({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <figure aria-label={label} className={`relative isolate ${className}`}>
      <div className="rounded-[6.5%/4.6%] bg-[#05070d] p-[3.6%] shadow-[0_calc(97px*var(--screen-zoom,0.5))_calc(194px*var(--screen-zoom,0.5))_calc(-54px*var(--screen-zoom,0.5))_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <Screen {...TABLET} className="rounded-[2.6%/1.8%]">{children}</Screen>
      </div>
    </figure>
  );
}

/** A laptop: the lid with the screen, and the base. Fills its container's width. */
export function LaptopFrame({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <figure aria-label={label} className={`relative isolate ${className}`}>
      <div className="relative mx-[6%] rounded-t-[2.2%/3.5%] bg-[#05070d] px-[1.5%] pb-[2.4%] pt-[1.9%] ring-1 ring-white/10">
        <span aria-hidden="true" className="absolute left-1/2 top-[0.75%] size-[0.45%] -translate-x-1/2 rounded-full bg-[#1d2333]" />
        <Screen {...DESKTOP} className="rounded-[0.4%/0.6%]">{children}</Screen>
      </div>
      {/* Base, wider than the lid, with the thumb notch */}
      <div aria-hidden="true" className="relative h-[clamp(8px,1.6vw,18px)] rounded-b-[40%_100%] bg-gradient-to-b from-[#3a4152] to-[#161a24] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.55)]">
        <span className="absolute left-1/2 top-0 h-[38%] w-[14%] -translate-x-1/2 rounded-b-[10px] bg-[#0b0e15]" />
      </div>
    </figure>
  );
}

/** A desktop browser's tab strip and address bar, 46px tall. */
export function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex h-[46px] shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900 px-5">
      <div className="flex gap-2">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex gap-3 pl-3 text-slate-500">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div className="mx-auto flex h-[30px] w-[520px] items-center justify-center gap-2 rounded-lg bg-bg text-[13px] text-slate-400">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" /></svg>
        {url}
      </div>
      <div className="w-[104px]" />
    </div>
  );
}

/** A desktop browser window showing an app page at 1440 × 900, chrome included. */
export function BrowserFrame({ label, url, className = "", children }: { label: string; url: string; className?: string; children: React.ReactNode }) {
  return (
    <figure aria-label={label} className={`relative isolate overflow-hidden rounded-[10px] shadow-[0_calc(78px*var(--screen-zoom,0.5))_calc(156px*var(--screen-zoom,0.5))_calc(-62px*var(--screen-zoom,0.5))_rgba(0,0,0,0.6)] ring-1 ring-slate-700/60 ${className}`}>
      <Screen {...DESKTOP}>
        <div className="flex h-full flex-col">
          <BrowserChrome url={url} />
          <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </Screen>
    </figure>
  );
}
