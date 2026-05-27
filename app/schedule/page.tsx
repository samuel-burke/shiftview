import { Suspense } from "react";
import SchedulePageClient from "./schedulePageClient";

export default function SchedulePage() {
  return (
    <Suspense>
      <SchedulePageClient />
    </Suspense>
  );
}
