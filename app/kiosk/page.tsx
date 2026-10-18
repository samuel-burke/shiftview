import type { Metadata } from "next";
import KioskClient from "./kioskClient";

export const metadata: Metadata = {
  title: "Time Clock Kiosk · ShiftView",
  robots: { index: false, follow: false },
};

// The store tablet's time clock. No sign-in: the device's kiosk cookie (set
// when a manager registered it in Settings) and each employee's PIN are the
// credentials, both checked by /api/kiosk/*.
export default function KioskPage() {
  return <KioskClient />;
}
