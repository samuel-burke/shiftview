import { Suspense } from "react";
import DraftPageClient from "./draftPageClient";

export default function DraftPage() {
  return (
    <Suspense>
      <DraftPageClient />
    </Suspense>
  );
}
