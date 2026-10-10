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

  const { pathname } = request.nextUrl;
  // API routes authenticate themselves (getOrgContext/requireManager, which
  // also refresh an expired session and write its cookies) and must answer
  // with JSON status codes (401/403), never an HTML redirect — redirecting
  // turns an unauthenticated POST (e.g. /api/demo/start, cron jobs) into a
  // method-preserving 307 to /login, which then 405s. Checking the session
  // here as well only added a Supabase Auth round trip to every API call.
  if (pathname.startsWith("/api/")) {
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

  // getClaims() refreshes an expired session (writing its cookies through
  // setAll above) and verifies the JWT — locally against the project's cached
  // signing keys when it uses asymmetric keys, otherwise via the Auth server
  // as getUser() did.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;
  const isPublic = pathname === "/" || pathname === "/welcome" || pathname === "/login" || pathname === "/signup" || pathname === "/privacy" || pathname === "/contact" || pathname.startsWith("/auth/");

  if (!signedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // "/" is the dashboard when signed in and the landing page otherwise. They
  // are separate routes (app/page.tsx, app/welcome) so neither downloads the
  // other's code; visitors get the landing page at "/" through a rewrite.
  if (pathname === "/" && !signedIn) {
    const landing = NextResponse.rewrite(new URL("/welcome", request.url), { request });
    supabaseResponse.cookies.getAll().forEach((cookie) => landing.cookies.set(cookie));
    return landing;
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest.json|sw.js).*)"],
};
