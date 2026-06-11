import { Suspense } from "react";
import CoveragePageClient from "./coveragePageClient";

export default function CoveragePage() {
  return (
    <Suspense>
      <CoveragePageClient />
    </Suspense>
  );
}
