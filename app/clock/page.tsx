import { Suspense } from "react";
import ClockPageClient from "./clockPageClient";

export default function ClockPage() {
  return (
    <Suspense>
      <ClockPageClient />
    </Suspense>
  );
}
