"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

export default function AuthCallback() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const { searchParams } = new URL(window.location.href);
    const code = searchParams.get("code");

    // Implicit flow: tokens are in the URL hash (#access_token=...&refresh_token=...)
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
  }, []);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center">
      <div className="text-slate-500 text-sm">Signing you in…</div>
    </main>
  );
}
