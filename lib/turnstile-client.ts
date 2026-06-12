// Client-side Cloudflare Turnstile loader, shared by the demo entry button
// and the login page. Active only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set;
// without it callers skip the challenge entirely (local dev, e2e).
//
// Tokens are single-use: verify them in exactly one place. With Supabase
// Auth's CAPTCHA protection enabled, that place is Supabase — pass the token
// via options.captchaToken and do not call siteverify yourself.

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileApi = {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    "error-callback"?: (errorCode?: string) => void;
    "expired-callback"?: () => void;
    appearance?: "always" | "execute" | "interaction-only";
  }) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"));
    script.onerror = () => { scriptPromise = null; reject(new Error("turnstile script failed")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
