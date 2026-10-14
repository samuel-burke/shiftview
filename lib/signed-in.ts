import { createClient } from "@/lib/supabase-server";

// Whether the request carries a signed-in session, for the public pages that
// show different chrome to signed-in people (/contact, /privacy).
export async function isSignedIn(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return false;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return !!data?.claims?.sub;
}
