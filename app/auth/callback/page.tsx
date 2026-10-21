"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AuthCallback() {
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    // A PKCE code can only be exchanged once, including in Strict Mode.
    if (handled.current) return;
    handled.current = true;

    async function handle() {
      const code = new URL(window.location.href).searchParams.get("code");
      if (!code) {
        // Fragment credentials (including invites) are not browser-bound.
        // Require the existing email-code login instead of adopting an account.
        router.replace("/login");
        return;
      }

      try {
        const { createClient } = await import("@/lib/supabase-browser");
        const { error } = await createClient().auth.exchangeCodeForSession(code);
        router.replace(error ? "/login" : "/");
        router.refresh();
      } catch {
        router.replace("/login");
      }
    }

    void handle();
  }, [router]);

  return (
    <main className="min-h-dvh bg-bg flex items-center justify-center">
      <div className="text-fg-subtle text-sm">Signing you in…</div>
    </main>
  );
}
