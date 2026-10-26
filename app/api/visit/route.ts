import { NextResponse, after } from "next/server";
import { sendSlackAlert } from "@/lib/slack";
import { cleanRef, notableReferrerHost } from "@/lib/notable-visit";

export const dynamic = "force-dynamic";

// POST /api/visit — sent once per browser session by NotableVisitBeacon when a
// visitor arrives through a tagged link (?ref=…) or from a hiring/developer
// site. Pushes a Slack alert to the operator; stores nothing. Always answers
// 204 so the endpoint reveals nothing about what it does with the data.
//
// Public and unauthenticated, so: a strict per-instance rate limit (same
// caveat as /api/demo/start) and only well-formed, allow-listed values ever
// reach the alert text.
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

const PATH_RE = /^\/[a-z0-9/_-]{0,63}$/i;

export async function POST(request: Request) {
  const noContent = new NextResponse(null, { status: 204 });
  if (!process.env.SLACK_WEBHOOK_URL) return noContent;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return noContent;

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const referrer = notableReferrerHost(body?.referrer);
  if (!ref && !referrer) return noContent;
  const path = typeof body?.path === "string" && PATH_RE.test(body.path) ? body.path : "/";

  const where = [
    request.headers.get("x-vercel-ip-city"),
    request.headers.get("x-vercel-ip-country-region"),
    request.headers.get("x-vercel-ip-country"),
  ]
    .filter(Boolean)
    .map((part) => {
      try { return decodeURIComponent(part!); } catch { return part!; }
    })
    .join(", ");

  const source = [ref && `ref=${ref}`, referrer && `from ${referrer}`].filter(Boolean).join(", ");
  const lines = [`Someone landed on ${path} (${source}).`];
  if (where) lines.push(`Location: ${where}`);

  after(() =>
    sendSlackAlert({
      title: "Possible recruiter visit",
      message: lines.join("\n"),
      emoji: "briefcase",
    })
  );

  return noContent;
}
