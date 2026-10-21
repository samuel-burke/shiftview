import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    {
      // The callback explicitly exchanges PKCE codes. Never adopt URL sessions
      // during shared-client initialization or consume the same code twice.
      auth: { detectSessionInUrl: false },
    }
  );
}
