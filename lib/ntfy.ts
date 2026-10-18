// Operator alerts via ntfy (https://ntfy.sh). Configured by env vars and a
// no-op when NTFY_TOPIC_URL is unset. Never throws: an alert failing must not
// break the request that triggered it.

const TIMEOUT_MS = 5000;

export async function sendNtfy({
  title,
  message,
  tags,
  priority,
}: {
  title: string;
  message: string;
  /** ntfy tags / emoji shortcodes, e.g. ["tada"]. */
  tags?: string[];
  /** ntfy priority, 1 (min) to 5 (max); ntfy's default is 3. */
  priority?: 1 | 2 | 3 | 4 | 5;
}): Promise<void> {
  const url = process.env.NTFY_TOPIC_URL;
  if (!url) return;

  const headers: Record<string, string> = {
    // HTTP headers must be ASCII-safe; ntfy decodes RFC 2047 encoded words.
    Title: `=?UTF-8?B?${Buffer.from(title, "utf8").toString("base64")}?=`,
  };
  if (tags?.length) headers.Tags = tags.join(",");
  if (priority) headers.Priority = String(priority);
  const token = process.env.NTFY_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: message,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[ntfy] ${res.status}: ${await res.text().catch(() => "")}`);
  } catch (err) {
    console.error("[ntfy]", err);
  }
}
