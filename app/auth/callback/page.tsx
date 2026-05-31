"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // All Supabase work runs client-side only, after mount
    import("@/lib/supabase-browser").then(({ createClient }) => {
      const supabase = createClient();
      const { searchParams } = new URL(window.location.href);
      const code = searchParams.get("code");

      const hash = new URLSearchParams(window.location.hash.slice(1));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");

      async function handle() {
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        } else if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
        router.push("/");
        router.refresh();
      }

      handle();
    });
  }, []);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-slate-500 text-sm">Signing you in…</div>
    </main>
  );
}
