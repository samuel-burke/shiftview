// Client-side Cloudflare Turnstile loader, shared by the demo entry button
// and the signup page. Active only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set;
// without it callers skip the challenge entirely (local dev, e2e).
//
// Tokens are single-use and verified server-side (route-level) by the
// endpoint each widget feeds — /api/demo/start and /api/auth/signup-otp —
// against siteverify with TURNSTILE_SECRET_KEY.

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileApi = {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    "error-callback"?: (errorCode?: string) => void;
    "expired-callback"?: () => void;
    appearance?: "always" | "execute" | "interaction-only";
    theme?: "light" | "dark" | "auto";
    size?: "normal" | "flexible" | "compact";
  }) => string;
  reset: (widgetId: string) => void;
};

// Match the widget to the app theme (ThemeProvider reflects the resolved
// scheme onto <html data-theme>); Turnstile's "auto" follows the OS instead,
// which can clash when the user overrides the theme in-app.
export function turnstileTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

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
