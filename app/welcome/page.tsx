import type { Metadata } from "next";
import LandingPage from "../landing";

// The landing page for signed-out visitors. It lives at "/" — the proxy
// rewrites signed-out requests for "/" here — but is its own route so the
// dashboard (also at "/") and the landing page each ship only their own code.
export const dynamic = "force-dynamic"; // the demos run on the sample store's today

export const metadata: Metadata = {
  title: "ShiftView · Scheduling and time clock for shift teams",
  description: "Build the week, see live coverage as people clock in, and approve requests from your phone. Scheduling, time clock and coverage for retail and fulfillment teams.",
  openGraph: {
    title: "ShiftView",
    description: "Scheduling, time clock and live coverage for retail and fulfillment teams.",
    type: "website",
  },
  alternates: { canonical: "/" },
};

export default function WelcomePage() {
  return <LandingPage />;
}
