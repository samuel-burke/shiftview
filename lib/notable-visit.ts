// Shared between NotableVisitBeacon (client) and POST /api/visit (server).
// A "notable" visit is one that probably came from someone evaluating the app:
// a tagged link (e.g. ?ref=resume on a resume or job application) or a
// referral from a hiring or developer site.

export const NOTABLE_REFERRER_HOSTS = [
  "linkedin.com",
  "lnkd.in",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "github.com",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "ycombinator.com",
];

const REF_RE = /^[a-z0-9_-]{1,32}$/i;

/** The ?ref= tag if it's well-formed, else null. */
export function cleanRef(ref: unknown): string | null {
  return typeof ref === "string" && REF_RE.test(ref) ? ref : null;
}

/** The referrer's host when it's one of the notable sites, else null. */
export function notableReferrerHost(host: unknown): string | null {
  if (typeof host !== "string" || host.length > 253) return null;
  const h = host.toLowerCase().replace(/^www\./, "");
  return NOTABLE_REFERRER_HOSTS.some((d) => h === d || h.endsWith(`.${d}`)) ? h : null;
}
