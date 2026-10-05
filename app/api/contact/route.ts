import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { CONTACT_LIMITS as LIMITS, TOPIC_LABELS, isContactTopic } from "@/lib/contact";

export const dynamic = "force-dynamic";

// POST /api/contact — public contact form on /contact. Delivers the message by
// email to CONTACT_TO_EMAIL (never exposed to the client) with Reply-To set to
// the submitter, so answering is one click from the inbox.
//
// Abuse controls, cheapest first:
//   1. Honeypot: a visually hidden "website" field humans never fill. Bots
//      that do get a 200 so they don't learn to skip it; nothing is sent.
//   2. Best-effort per-instance rate limit (same caveat as /api/demo/start:
//      serverless memory only blunts naive loops on one warm instance).
//   3. Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_LIMIT = 5;
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

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

type Body = {
  name?: unknown;
  email?: unknown;
  topic?: unknown;
  message?: unknown;
  website?: unknown;
  turnstileToken?: unknown;
};

export async function POST(request: Request) {
  const to = process.env.CONTACT_TO_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) {
    // Fail loudly rather than accept a message that goes nowhere.
    console.error("[api/contact] CONTACT_TO_EMAIL or RESEND_API_KEY is not set");
    return NextResponse.json({ error: "The contact form isn't available right now" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many messages — please try again later" }, { status: 429 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const topic = isContactTopic(body.topic) ? body.topic : null;

  if (!name || name.length > LIMITS.name) {
    return NextResponse.json({ error: "Please enter your name" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > LIMITS.email) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }
  if (!topic) {
    return NextResponse.json({ error: "Please choose a topic" }, { status: 400 });
  }
  if (message.length < LIMITS.minMessage || message.length > LIMITS.message) {
    return NextResponse.json(
      { error: `Message must be between ${LIMITS.minMessage} and ${LIMITS.message} characters` },
      { status: 400 }
    );
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstileToken === "string" ? body.turnstileToken : null;
    if (!(await verifyTurnstileToken(token, ip === "unknown" ? null : ip))) {
      return NextResponse.json({ error: "Verification failed — please try again" }, { status: 403 });
    }
  }

  // Header injection guard: the name lands in the subject line.
  const safeSubjectName = name.replace(/[\r\n]+/g, " ");
  const html = `
    <p><strong>${escapeHtml(TOPIC_LABELS[topic])}</strong> from ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    <hr />
    <p style="color:#64748b;font-size:12px">Sent from the ShiftView contact form. Reply to this email to answer ${escapeHtml(name)} directly.</p>
  `;

  try {
    await sendEmail({
      to,
      subject: `[ShiftView] ${TOPIC_LABELS[topic]} from ${safeSubjectName}`,
      html,
      replyTo: email,
    });
  } catch (err) {
    console.error("[api/contact] send failed:", err);
    return NextResponse.json({ error: "We couldn't send your message — please try again" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
