import { Suspense } from "react";
import SchedulePageClient from "./schedulePageClient";
import PageShellFallback from "@/components/PageShellFallback";

export default function SchedulePage() {
  return (
    <Suspense fallback={<PageShellFallback active="schedule" topBar />}>
      <SchedulePageClient />
    </Suspense>
  );
}
