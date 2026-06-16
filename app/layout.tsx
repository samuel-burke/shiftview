import "./globals.css";
import { Suspense } from "react";
import ServiceWorkerRegistrar from "../components/ServiceWorkerRegistrar";
import AddToHomeScreenBanner from "../components/AddToHomeScreenBanner";
import InAppNotificationBanner from "../components/InAppNotificationBanner";
import PresenceHeartbeat from "../components/PresenceHeartbeat";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "../components/ThemeProvider";
import { AppDataProvider } from "../lib/AppDataContext";
import ClockStatusRing from "../components/ClockStatusRing";

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
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <meta name="theme-color" content="#0a1628" />
        <meta name="screen-orientation" content="portrait" />
        {/*
          viewport-fit=cover lets the web view extend into the safe areas
          (under the iOS status bar and home indicator) in standalone PWA mode.
          This is what activates the env(safe-area-inset-*) padding already used
          by the body, TopBar and BottomNav — and it lets the ambient status
          ring reach edge-to-edge, glowing behind the status bar too.
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>
        <ThemeProvider>
          <Suspense>
            <AppDataProvider>
              {children}
              <ClockStatusRing />
            </AppDataProvider>
          </Suspense>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
        <AddToHomeScreenBanner />
        <InAppNotificationBanner />
        <PresenceHeartbeat />
        <SpeedInsights />
      </body>
    </html>
  );
}
