// E2E runs intercept every /api/* call client-side and have no Supabase, so
// the Playwright webServer sets E2E_BYPASS_AUTH=1 to skip the server-side
// auth gate on pages (see playwright.config.ts). A Vercel production
// deployment ignores the flag, so setting it there by mistake can't turn the
// gate off. (Playwright runs a production build, so NODE_ENV can't decide.)
export function isE2eBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_BYPASS_AUTH === "1" && env.VERCEL_ENV !== "production";
}
