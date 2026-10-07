import { redirect } from "next/navigation";

// The Planner is now the Week page's Draft mode. Old links and bookmarks land
// there, keeping their query (e.g. ?week=2026-10-11).
export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams({ mode: "draft" });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "mode" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  redirect(`/week?${query}`);
}
