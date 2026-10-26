// Operator alerts via a Slack incoming webhook. Configured by SLACK_WEBHOOK_URL
// (server-only: never NEXT_PUBLIC_, since anyone holding the URL can post to the
// channel) and a no-op when it's unset. Never throws: an alert failing must not
// break the request that triggered it. Keep personal data (names, emails,
// message bodies) out of alerts: Slack is a third party that keeps them.

const TIMEOUT_MS = 5000;
const WEBHOOK_PREFIX = "https://hooks.slack.com/";

// Slack treats &, < and > as control characters in message text.
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendSlackAlert({
  title,
  message,
  emoji,
}: {
  title: string;
  message: string;
  /** Slack emoji shortcode without colons, e.g. "tada". */
  emoji?: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return;
  if (!url.startsWith(WEBHOOK_PREFIX)) {
    console.error("[slack] SLACK_WEBHOOK_URL is not a Slack incoming webhook URL; alert skipped");
    return;
  }

  const prefix = emoji ? `:${emoji}: ` : "";
  const text = `${prefix}*${escapeSlack(title)}*\n${escapeSlack(message)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Slack's error bodies are short codes like "invalid_payload"; never log the URL.
    if (!res.ok) console.error(`[slack] ${res.status}: ${await res.text().catch(() => "")}`);
  } catch (err) {
    console.error("[slack]", err instanceof Error ? err.message : err);
  }
}
