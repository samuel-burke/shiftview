import "./globals.css";
import ServiceWorkerRegistrar from "../components/ServiceWorkerRegistrar";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "../components/ThemeProvider";

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
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <meta name="theme-color" content="#0a1628" />
        <meta name="screen-orientation" content="portrait" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <ServiceWorkerRegistrar />
        <SpeedInsights />
      </body>
    </html>
  );
}
