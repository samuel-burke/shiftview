// Environment variables a production deployment of shiftview.app needs. Each
// one missing would otherwise only show up later, as a feature failing (or,
// for Turnstile, quietly turning its bot check off). next.config.ts runs this
// for Vercel production builds, so a deploy without them fails instead.
// Preview and local builds aren't checked.
export const REQUIRED_PRODUCTION_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MESSAGE_ENCRYPTION_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "CRON_SECRET",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "RESEND_API_KEY",
  "CONTACT_TO_EMAIL",
] as const;

// Returns one line per problem; empty when the environment is complete.
export function productionEnvProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = REQUIRED_PRODUCTION_ENV
    .filter((name) => !env[name]?.trim())
    .map((name) => `${name} is not set`);
  const key = env.MESSAGE_ENCRYPTION_KEY?.trim();
  if (key && !/^[0-9a-fA-F]{64}$/.test(key)) {
    problems.push("MESSAGE_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
  }
  if (env.E2E_BYPASS_AUTH) {
    problems.push("E2E_BYPASS_AUTH must not be set (it is for Playwright runs only)");
  }
  return problems;
}
