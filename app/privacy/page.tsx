import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = { title: "Privacy Policy — ShiftView" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-100 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-slate-400 border-collapse">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-slate-800">
              <th scope="row" className="py-2 pr-6 font-medium text-slate-300 whitespace-nowrap text-left">{a}</th>
              <td className="py-2">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-bg px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-8 py-3 -my-3"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </Link>

        <div className="mb-3">
          <Logo className="h-5" />
        </div>

        <h1 className="text-2xl font-extrabold text-slate-100 tracking-tight mb-1">Privacy Policy</h1>
        <p className="text-xs text-slate-500 mb-8">Last updated: October 9, 2026</p>

        <div className="bg-card border border-slate-800/60 rounded-2xl px-5 py-6 [@media(min-width:640px)]:px-7 [@media(min-width:640px)]:py-7 text-sm text-slate-400 leading-relaxed space-y-1">
          <Section title="1. Who We Are">
            <p>
              ShiftView is a shift management tool for retail and hospitality teams. The service is operated by the
              owner of the ShiftView account you sign in through. References to &ldquo;we&rdquo;, &ldquo;us&rdquo;,
              or &ldquo;our&rdquo; refer to that operator.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <Table
              rows={[
                ["Email address", "Used for authentication via Supabase Auth"],
                ["Display name", "Your name as it appears on shift cards and in messages"],
                ["Shift and schedule data", "Shift times and dates associated with your employee record"],
                ["Clock records", "Clock-in and clock-out timestamps, if punch tracking is enabled"],
                ["Messages", "Text messages sent between employees and managers within the app"],
                ["Push tokens", "Notification subscription tokens if you grant notification permission"],
                ["Technical data", "Session tokens (stored in your browser) and standard server logs retained by the hosting provider"],
                ["Contact form", "Your name, email address, topic and message when you write to us through the contact form"],
              ]}
            />
          </Section>

          <Section title="3. How We Use Your Information">
            <Table
              rows={[
                ["Schedule and coverage dashboard", "Name, shift times"],
                ["In-app and push notifications", "Name, notification tokens, message content"],
                ["Manager-to-employee messaging", "Name, message content"],
                ["Authentication and access control", "Email, session token"],
                ["Audit trail for schedule changes", "User ID, timestamps"],
                ["Replying to contact form messages", "Name, email address, message"],
              ]}
            />
            <p className="mt-3">
              We do not sell, rent, or share your personal information with third parties for marketing purposes.
            </p>
          </Section>

          <Section title="4. Message Encryption">
            <p>
              Message text is encrypted at rest using <span className="text-slate-300 font-medium">AES-256-GCM</span> before
              it is stored with the message. The server decrypts it only to show the message to its sender or its
              recipient.
            </p>
            <p className="mt-3">
              When you receive a message, ShiftView also creates a notification for you, shown in the app and, if you
              allow it, as a push notification. That notification includes the message text as a preview, and it is
              stored in the database <span className="text-slate-300 font-medium">without</span> this encryption.
              Clearing a notification hides it from you but does not delete it (see Data Retention).
            </p>
            <p className="mt-3">Messages and notifications in transit are protected by TLS (HTTPS).</p>
          </Section>

          <Section title="5. Data Storage and Security">
            <p>
              Data is stored in a PostgreSQL database managed by Supabase, hosted on AWS infrastructure. Row Level
              Security is enabled on all tables — users can only read and write records they are authorized to access.
              Passwords are never stored; authentication is handled entirely by Supabase Auth.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <ul className="list-disc list-inside space-y-1">
              <li>Schedule and employee data is retained for as long as you have an active account.</li>
              <li>Messages are retained indefinitely unless deleted by an administrator.</li>
              <li>
                Notifications, including message previews, are kept until the organization is deleted. Clearing a
                notification hides it from you but does not delete it, and deleting your account does not remove the
                notifications you received.
              </li>
              <li>Push subscriptions are removed automatically when a device unsubscribes or the subscription becomes stale.</li>
              <li>
                <span className="text-slate-300">Account deletion:</span> you can delete your account at any time from
                Settings → Delete Account. This permanently removes your login, push subscriptions, and notification
                preferences. Your name and your past schedule and clock records are retained by your organization as
                part of its business records (for example, payroll); ask your administrator to remove your employee
                record if you want those deleted as well.
              </li>
              <li>
                <span className="text-slate-300">Organization deletion:</span> an organization owner can permanently
                delete the entire organization from Settings → Delete Organization. This removes all of the
                organization&apos;s data — employee records, schedules, clock records, messages, settings, and audit
                logs. Members&apos; accounts are not deleted; they keep their logins and can join or create other
                organizations.
              </li>
            </ul>
          </Section>

          <Section title="7. Your Rights">
            <p>Depending on where you are located, you may have the right to:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><span className="text-slate-300">Access</span> the personal data we hold about you</li>
              <li><span className="text-slate-300">Correct</span> inaccurate information</li>
              <li><span className="text-slate-300">Request deletion</span> of your account and associated data</li>
              <li><span className="text-slate-300">Object to or restrict</span> certain types of processing</li>
            </ul>
            <p className="mt-3">
              You can delete your account yourself at any time from Settings → Delete Account (organization owners
              must first delete their organization or transfer it). To exercise any other right, contact your account
              administrator or reach out via the contact information below.
            </p>
          </Section>

          <Section title="8. Cookies and Local Storage">
            <p>
              ShiftView uses browser storage (cookies and <code className="text-slate-300">localStorage</code>) only to
              maintain your authentication session. No third-party tracking cookies are used.
            </p>
          </Section>

          <Section title="9. Third-Party Services">
            <Table
              rows={[
                ["Supabase", "Database, authentication (including sign-in and invite emails), and real-time"],
                ["Vercel", "Hosting and edge delivery"],
                ["Web Push (browser API)", "Push notifications, handled by your browser/OS vendor"],
                ["Resend", "Delivery of contact form emails and low-coverage alerts to managers"],
                ["Cloudflare Turnstile", "Bot protection on the demo, sign-up and contact forms"],
              ]}
            />
          </Section>

          <Section title="10. Children's Privacy">
            <p>
              ShiftView is not intended for use by anyone under the age of 16. We do not knowingly collect personal
              information from minors.
            </p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>
              We may update this policy from time to time. When we do, the &ldquo;Last updated&rdquo; date at the top
              of this page will change. Continued use of the service after changes are posted constitutes acceptance
              of the updated policy.
            </p>
          </Section>

          <Section title="12. Contact">
            <p>
              If you have questions about this privacy policy or how your data is handled, please contact the
              administrator of your ShiftView account, or write to us through the{" "}
              <Link href="/contact" className="text-slate-300 underline underline-offset-2 hover:text-slate-100">contact form</Link>.
              Contact form messages are delivered to us by email and kept only as long as needed to respond.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
