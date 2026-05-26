import { createClient } from "@/lib/supabase-server";

export async function requireManager(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Not authenticated" as const };

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!managerRow) return { user, error: "Manager access required" as const };
  return { user, error: null };
}
