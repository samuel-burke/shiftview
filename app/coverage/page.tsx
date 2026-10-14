import { Suspense } from "react";
import CoveragePageClient from "./coveragePageClient";
import PageShellFallback from "@/components/PageShellFallback";

export default function CoveragePage() {
  return (
    <Suspense fallback={<PageShellFallback active="settings" />}>
      <CoveragePageClient />
    </Suspense>
  );
}
