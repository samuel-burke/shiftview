"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CONTACT_LIMITS, CONTACT_TOPICS, TOPIC_LABELS, isContactTopic, type ContactTopic } from "@/lib/contact";
import { TURNSTILE_SITE_KEY, loadTurnstile, turnstileTheme } from "@/lib/turnstile-client";
import { Arrow, primaryBtn } from "./ui";

const field =
  "w-full rounded-lg border border-slate-700 bg-card px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30";
const label = "mb-1.5 block text-sm font-medium text-slate-200";

const noSubscribe = () => () => {};

// Posts to /api/contact. ?topic=bug|feature|question|other preselects the
// topic (the beta notice links here with ?topic=feedback → "feature"). The
// query is read from the location rather than useSearchParams, so the form is
// in the server HTML instead of appearing (and pushing the page) after
// hydration; the preselected topic is applied as soon as it hydrates.
export default function ContactForm() {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const initialTopic = new URLSearchParams(search).get("topic");
  const urlTopic: ContactTopic =
    initialTopic === "feedback" ? "feature" : isContactTopic(initialTopic) ? initialTopic : "question";
  const [pickedTopic, setTopic] = useState<ContactTopic | null>(null);
  const topic = pickedTopic ?? urlTopic;
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !widgetRef.current || widgetId.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !widgetRef.current) return;
        widgetId.current = t.render(widgetRef.current, {
          sitekey: TURNSTILE_SITE_KEY!,
          theme: turnstileTheme(),
          size: "flexible",
          callback: setToken,
          "expired-callback": () => setToken(null),
          "error-callback": () => setError("Verification failed to load — please refresh and try again"),
        });
      })
      .catch(() => setError("Verification failed to load — please refresh and try again"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (TURNSTILE_SITE_KEY && !token) {
      setError("Please complete the verification below");
      return;
    }
    const form = new FormData(e.currentTarget);
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          topic,
          message: form.get("message"),
          website: form.get("website"),
          turnstileToken: token,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "We couldn't send your message — please try again");
      }
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send your message — please try again");
      setStatus("idle");
      // Turnstile tokens are single use.
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
      setToken(null);
    }
  }

  if (status === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-slate-800 bg-card p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-500/15 text-green-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 className="mt-4 text-lg font-semibold text-slate-100">Message sent</h2>
        <p className="mt-1.5 text-sm text-slate-400">Thanks for reaching out. We&rsquo;ll reply to the email you gave us.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className={label}>Name</label>
          <input id="contact-name" name="name" required maxLength={CONTACT_LIMITS.name} autoComplete="name" className={field} />
        </div>
        <div>
          <label htmlFor="contact-email" className={label}>Email</label>
          <input id="contact-email" name="email" type="email" required maxLength={CONTACT_LIMITS.email} autoComplete="email" className={field} />
        </div>
      </div>

      <fieldset>
        <legend className={label}>Topic</legend>
        <div className="grid grid-cols-2 gap-2">
          {CONTACT_TOPICS.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/50 ${
                topic === t ? "border-blue-500 bg-blue-500/10 text-slate-100" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              }`}
            >
              <input type="radio" name="topic" value={t} checked={topic === t} onChange={() => setTopic(t)} className="sr-only" />
              {TOPIC_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="contact-message" className={label}>Message</label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={CONTACT_LIMITS.minMessage}
          maxLength={CONTACT_LIMITS.message}
          rows={6}
          placeholder={topic === "bug" ? "What happened, and what did you expect? Which page and device?" : "How can we help?"}
          className={`${field} resize-y`}
        />
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots that fill it are dropped server-side. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {TURNSTILE_SITE_KEY && <div ref={widgetRef} className="min-h-[65px]" />}

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      <button type="submit" disabled={status === "sending"} className={`${primaryBtn} w-full cursor-pointer disabled:cursor-wait disabled:opacity-60 sm:w-auto`}>
        {status === "sending" ? "Sending…" : <>Send message <Arrow /></>}
      </button>
    </form>
  );
}
