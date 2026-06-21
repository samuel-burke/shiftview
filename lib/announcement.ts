// Pure validation for team announcements — an org-wide message a manager posts
// to all staff (distinct from the 1:1 encrypted DMs in /api/messages).

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 2000;

export type AnnouncementInput = { title?: unknown; body?: unknown };

export type ValidationResult =
  | { valid: true; value: { title: string; body: string } }
  | { valid: false; error: string };

export function validateAnnouncement(input: AnnouncementInput): ValidationResult {
  const { title, body } = input;

  if (typeof title !== "string" || !title.trim())
    return { valid: false, error: "Title is required" };
  if (typeof body !== "string" || !body.trim())
    return { valid: false, error: "Message is required" };

  const t = title.trim();
  const b = body.trim();

  if (t.length > ANNOUNCEMENT_TITLE_MAX)
    return { valid: false, error: `Title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer` };
  if (b.length > ANNOUNCEMENT_BODY_MAX)
    return { valid: false, error: `Message must be ${ANNOUNCEMENT_BODY_MAX} characters or fewer` };

  return { valid: true, value: { title: t, body: b } };
}
