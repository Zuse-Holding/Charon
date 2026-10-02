import type { Metadata } from "next";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import { LEGAL_PAGES_FINAL } from "../../lib/legal";
import styles from "./legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Metis",
  description: "How Metis collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div className={styles.header}>
        {!LEGAL_PAGES_FINAL && <div className={styles.draftBadge}>DRAFT — PENDING LEGAL REVIEW</div>}
        <h1 className={styles.title}>Privacy Policy</h1>
        <div className={styles.updated}>Last updated: October 1, 2026</div>
      </div>

      <div className={styles.body}>
        <p>
          This policy is a working draft describing how Metis currently handles data. It has not
          yet been reviewed by counsel and should not be treated as a final, binding statement
          until that review is complete.
        </p>

        <h2>What we collect</h2>
        <p>When you create an account and use Metis, we collect:</p>
        <ul>
          <li><strong>Account information</strong> — name and email address, provided directly or via Google sign-in.</li>
          <li><strong>Research activity</strong> — the companies, people, and products you search for, and the reports and watchlists you create, so we can serve them back to you.</li>
          <li><strong>Usage data</strong> — basic technical logs (timestamps, request counts) needed to operate the service and enforce plan limits.</li>
          <li><strong>Product analytics</strong> — a small set of events (for example: signed up, ran a report, hit a plan limit, started checkout), tied to your account ID, so we can see which features get used. Event data doesn&apos;t include the names you research or the contents of your reports.</li>
          <li><strong>Billing information</strong> — your plan and subscription status. Card details go to our payment processor and never reach our servers.</li>
        </ul>
        <p>We don&apos;t run advertising trackers.</p>

        <h2>How we use it</h2>
        <ul>
          <li>To provide the research and reporting features you request.</li>
          <li>To operate your account, including enforcing the usage limits of your plan.</li>
          <li>To communicate with you about your account or changes to the service.</li>
        </ul>
        <p>We do not sell your personal data.</p>

        <h2>Who we share it with</h2>
        <p>
          We use service providers to run Metis. Each one gets only what its job needs:
        </p>
        <ul>
          <li><strong>Supabase</strong> — authentication and database. Your account and research data is stored there on our behalf.</li>
          <li><strong>Stripe</strong> — payments. Stripe handles your card details directly; Metis never stores them.</li>
          <li><strong>Search and AI providers</strong> — to build a report, the name of the company, person or product you research, and public web content about it, is sent to search and language-model providers (such as Serper, Groq and OpenRouter). Your name and email are not sent. Some of these providers may keep or use the requests they receive under their own terms, so don&apos;t put confidential information into a search.</li>
          <li><strong>Resend</strong> — account emails, such as the welcome email. It receives your email address and first name.</li>
          <li><strong>PostHog</strong> — the product analytics described above.</li>
          <li><strong>Vercel and Railway</strong> — hosting for the website and the research service.</li>
          <li><strong>Google</strong> — if you sign in with Google, it handles that sign-in under its own privacy policy.</li>
        </ul>
        <p>We don&apos;t share your data with anyone else, except where the law requires it.</p>

        <h2>Cookies</h2>
        <p>
          We use only the essential cookies required to keep you signed in. Analytics doesn&apos;t
          set cookies, and we don&apos;t set advertising or cross-site tracking cookies.
        </p>

        <h2>Data retention and deletion</h2>
        <p>
          Your account and research data is retained for as long as your account is active. You
          can request deletion of your account and associated data at any time by contacting us
          below.
        </p>

        <h2>Your rights</h2>
        <p>
          You can request a copy of your data, ask us to correct it, or ask us to delete it, by
          reaching out to the contact below. We'll respond within a reasonable time.
        </p>

        <h2>Children's privacy</h2>
        <p>Metis is not directed at, and is not knowingly used by, anyone under 16.</p>

        <h2>Changes to this policy</h2>
        <p>
          If this policy changes materially, we'll update the date at the top of this page and,
          where appropriate, notify account holders directly.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or your data can be sent to{" "}
          <a href="mailto:support@metisanalytic.com">support@metisanalytic.com</a>.
        </p>
      </div>
    </MarketingShell>
  );
}
