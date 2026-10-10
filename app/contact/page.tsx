import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import ContactForm from "@/components/marketing/ContactForm";
import { Container } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Contact · ShiftView",
  description: "Questions, bug reports or feature requests: send the ShiftView team a message.",
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <section>
        <Container className="grid gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16 lg:py-28">
          <div>
            <p className="mb-4 text-sm font-medium text-blue-400">Contact</p>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-slate-100 sm:text-5xl">
              Talk to a person.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-slate-400">
              Questions about setting up your team, a bug you ran into, or something you wish ShiftView did. Every
              message is read by the people who build it.
            </p>
            <dl className="mt-10 space-y-5 border-t border-slate-800/80 pt-8 text-sm">
              <div>
                <dt className="font-semibold text-slate-200">Reporting a bug?</dt>
                <dd className="mt-1 leading-relaxed text-slate-400">
                  Tell us what you did, what you expected, and the device you were on. Screenshots help, and we can ask
                  for them when we reply.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-200">Already using ShiftView?</dt>
                <dd className="mt-1 leading-relaxed text-slate-400">
                  For questions about your own team&rsquo;s schedule or account, your store manager or account owner is
                  the fastest route.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-200">Your data</dt>
                <dd className="mt-1 leading-relaxed text-slate-400">
                  We use what you send only to reply. See the{" "}
                  <Link href="/privacy" className="text-slate-300 underline underline-offset-2 hover:text-slate-100">privacy policy</Link>.
                </dd>
              </div>
            </dl>
          </div>
          <div className="rounded-2xl border border-slate-800 p-5 sm:p-8">
            <ContactForm />
          </div>
        </Container>
      </section>
    </MarketingShell>
  );
}
