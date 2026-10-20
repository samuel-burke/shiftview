const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = "ShiftView <noreply@shiftview.app>";

// Each part excludes "." so the dot between domain labels has only one way to
// match. The old /^[^\s@]+@[^\s@]+\.[^\s@]+$/ let the domain part and the
// "\." trade characters, which backtracks polynomially on input like
// "!@!." followed by many "!." (CodeQL js/polynomial-redos).
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

export function isValidEmail(email: string) {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

// For putting user-supplied text (names, messages) into an email's HTML.
export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  /** Where replies go instead of the no-reply sender (e.g. the contact form's submitter). */
  replyTo?: string;
}): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping email to", to);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    // reply_to is dropped from the JSON when undefined.
    body: JSON.stringify({ from: FROM, to, subject, html, reply_to: replyTo }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}
