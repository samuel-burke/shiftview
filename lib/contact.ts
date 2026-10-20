// Shared between the /contact form (client) and POST /api/contact (server).
import { MAX_EMAIL_LENGTH } from "@/lib/email-validation";

export const CONTACT_TOPICS = ["question", "bug", "feature", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const TOPIC_LABELS: Record<ContactTopic, string> = {
  question: "Question",
  bug: "Bug report",
  feature: "Feature request",
  other: "Other",
};

export const CONTACT_LIMITS = { name: 100, email: MAX_EMAIL_LENGTH, message: 5000, minMessage: 10 };

export function isContactTopic(v: unknown): v is ContactTopic {
  return typeof v === "string" && (CONTACT_TOPICS as readonly string[]).includes(v);
}
