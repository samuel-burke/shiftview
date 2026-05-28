import { Suspense } from "react";
import ReportsPageClient from "./reportsPageClient";
export default function ReportsPage() {
  return <Suspense fallback={null}><ReportsPageClient /></Suspense>;
}
