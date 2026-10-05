# Contact form setup

`/contact` posts to `POST /api/contact`, which emails the message through
[Resend](https://resend.com) to a private inbox with Reply-To set to the
sender. The code needs no changes to go live. It needs the configuration
below.

## 1. Resend

1. Create an API key at **Resend → API Keys** with *Sending access*.
2. Verify the sending domain at **Resend → Domains → Add domain →
   `shiftview.app`**, and add the SPF/DKIM DNS records Resend shows at your
   DNS provider. Mail is sent from `ShiftView <noreply@shiftview.app>`
   (`lib/email.ts`), so until the domain shows **Verified**, every send fails
   with a Resend 403 and the form shows "We couldn't send your message".

## 2. Cloudflare Turnstile (optional, recommended)

At **Cloudflare → Turnstile → Add widget**, add the hostnames
`shiftview.app` and `localhost`, plus your Vercel preview domain if you want
it to work on previews. This gives you a site key and a secret key.

Set **both or neither**:

| Set | Result |
|---|---|
| Neither | No bot check; honeypot + rate limit only |
| Both | Widget shown and verified server-side |
| Secret only | Widget never renders, so **every message is rejected** ("Verification failed") |
| Site key only | Widget shown but never verified |

The same keys also protect demo start and signup.

## 3. Vercel environment variables

**Vercel → Project → Settings → Environment Variables**, scoped to
*Production* (and *Preview* if you want the form there):

| Variable | Value | Required |
|---|---|---|
| `RESEND_API_KEY` | `re_…` from step 1 | Yes |
| `CONTACT_TO_EMAIL` | Inbox that should receive messages | Yes |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key | With the secret |
| `TURNSTILE_SECRET_KEY` | Turnstile secret key | With the site key |

Without `RESEND_API_KEY` or `CONTACT_TO_EMAIL`, the endpoint returns 503 and
the form shows "The contact form isn't available right now", rather than
accepting a message that goes nowhere.

`NEXT_PUBLIC_*` values are inlined at build time, so **redeploy** after
adding or changing them (Deployments → ⋯ → Redeploy).

## 4. Ship and check

1. Merge `dev` into `main`, or whichever branch Production deploys from.
   The form is not on `main` until then.
2. Open `https://shiftview.app/contact`, send a test message, and confirm it
   lands in `CONTACT_TO_EMAIL` with Reply-To set to the address you entered.
3. If it fails, check **Vercel → Logs** for `[api/contact]`:
   - `CONTACT_TO_EMAIL or RESEND_API_KEY is not set`: step 3.
   - `send failed: Error: Resend error 403`: domain not verified (step 1).
   - 403 `Verification failed` responses: Turnstile keys mismatched (step 2).

Limits: 5 messages per IP per hour (per serverless instance), message
10–5000 characters.
