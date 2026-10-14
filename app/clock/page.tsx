import { Suspense } from "react";
import ClockPageClient from "./clockPageClient";
import PageShellFallback from "@/components/PageShellFallback";

export default function ClockPage() {
  return (
    <Suspense fallback={<PageShellFallback active="clock" topBar />}>
      <ClockPageClient />
    </Suspense>
  );
}
