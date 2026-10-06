import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // E2E runs mock every /api/* call client-side; the Playwright webServer sets
  // E2E_BYPASS_AUTH=1 so app pages render without a session (see
  // playwright.config.ts and app/page.tsx). Never set in production.
  if (process.env.E2E_BYPASS_AUTH === "1") {
    return NextResponse.next({ request });
  }

  // No Supabase credentials — skip auth entirely (e.g. test/CI environments)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  // API routes authenticate themselves and must answer with JSON status
  // codes (401/403), never an HTML redirect — redirecting turns an
  // unauthenticated POST (e.g. /api/demo/start, cron jobs) into a
  // method-preserving 307 to /login, which then 405s.
  const isApi = pathname.startsWith("/api/");
  const isPublic = pathname === "/" || pathname === "/login" || pathname === "/signup" || pathname === "/privacy" || pathname === "/product" || pathname === "/contact" || pathname.startsWith("/auth/");

  if (!user && !isPublic && !isApi) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest.json|sw.js).*)"],
};
