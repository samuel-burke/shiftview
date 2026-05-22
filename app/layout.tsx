import "./globals.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <meta name="theme-color" content="#0a1628" />
        <meta name="screen-orientation" content="portrait" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
