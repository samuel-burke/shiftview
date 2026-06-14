// Vercel's cron scheduler sends `Authorization: Bearer ${CRON_SECRET}`;
// manual invocations historically use the `x-cron-secret` header. Accept both.
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    request.headers.get("x-cron-secret") === secret ||
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}
