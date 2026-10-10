import "./globals.css";
import { Suspense } from "react";
import ServiceWorkerRegistrar from "../components/ServiceWorkerRegistrar";
import DeferredNotificationBanner from "../components/DeferredNotificationBanner";
import PresenceHeartbeat from "../components/PresenceHeartbeat";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "../components/ThemeProvider";
import { AppDataProvider } from "../lib/AppDataContext";

export const metadata = {
  title: "ShiftView",
  description: "Fulfillment team shift scheduling dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ShiftView",
  },
};

const supabaseOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return null; }
})();

/* Inline script that runs before first paint to avoid theme flash. */
const themeInitScript = `
(function(){
  var t=localStorage.getItem('theme')||'system';
  var dark=(t==='dark')||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
})();
`.trim();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* The browser talks to Supabase directly for session refreshes and the
            Realtime socket; open that connection while the page loads. */}
        {supabaseOrigin && <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />}
        {supabaseOrigin && <link rel="dns-prefetch" href={supabaseOrigin} />}
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-apple-180.png" />
        <meta name="theme-color" content="#0a1628" />
        <meta name="screen-orientation" content="portrait" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </head>
      <body>
        <ThemeProvider>
          <Suspense>
            <AppDataProvider>
              {children}
            </AppDataProvider>
          </Suspense>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
        <DeferredNotificationBanner />
        <PresenceHeartbeat />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
