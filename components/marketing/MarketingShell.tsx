import Link from "next/link";
import { Inter } from "next/font/google";
import TryDemoButton from "@/components/TryDemoButton";
import Logo from "@/components/Logo";
import { CurrentYear, MotionProvider } from "./live";
import { Arrow, Container, REPO_URL, primaryBtn, secondaryBtn } from "./ui";

// font-display: optional: the font is preloaded, and if it isn't in by first
// paint the page keeps the (metric-matched) fallback rather than re-wrapping
// its text when Inter arrives.
const inter = Inter({ subsets: ["latin"], display: "optional" });

// Shared chrome for the public marketing pages (/ and /contact).
export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`${inter.className} min-h-dvh bg-bg text-slate-100 overflow-x-hidden antialiased`}>
      <MotionProvider>
        <MarketingNav />
        {children}
        <MarketingFooter />
      </MotionProvider>
    </main>
  );
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-bg/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="ShiftView home"><Logo className="h-[22px]" /></Link>
        <nav aria-label="Site navigation" className="flex items-center gap-1 sm:gap-2">
          <Link href="/login" className="whitespace-nowrap px-2 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-slate-100 sm:px-3">
            Sign in
          </Link>
          <Link href="/signup" className="ml-1 hidden whitespace-nowrap rounded-lg min-[360px]:block bg-gradient-to-r from-blue-500 to-violet-500 px-3.5 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-110">
            Get started
          </Link>
        </nav>
      </Container>
    </header>
  );
}

export function ClosingCta({ title = "See a real week before you set one up." }: { title?: string }) {
  return (
    <section>
      <Container className="flex flex-col items-start gap-8 py-20 lg:flex-row lg:items-end lg:justify-between lg:py-28">
        <div className="max-w-xl">
          <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-5xl">{title}</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400">
            The demo signs you in as a manager of a sample store with twelve people on the roster. Change anything you like.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-start">
          <TryDemoButton className={`${primaryBtn} w-full cursor-pointer sm:w-auto`}>
            Open the live demo <Arrow />
          </TryDemoButton>
          <Link href="/signup" className={secondaryBtn}>Create your organization</Link>
        </div>
      </Container>
    </section>
  );
}

function MarketingFooter() {
  return (
    <footer className="border-t border-slate-800/60">
      <Container className="flex flex-col gap-4 py-8 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo className="h-4" />
          <CurrentYear />
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/#features" className="transition-colors hover:text-slate-200">Features</Link>
          <Link href="/login" className="transition-colors hover:text-slate-200">Sign in</Link>
          <Link href="/contact" className="transition-colors hover:text-slate-200">Contact</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-200">Privacy</Link>
          <a href={REPO_URL} className="transition-colors hover:text-slate-200">GitHub</a>
        </nav>
      </Container>
    </footer>
  );
}
