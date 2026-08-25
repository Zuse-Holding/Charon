import type { Metadata } from "next";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import styles from "./legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Metis",
  description: "How Metis collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <div className={styles.header}>
        <div className={styles.draftBadge}>DRAFT — PENDING LEGAL REVIEW</div>
        <h1 className={styles.title}>Privacy Policy</h1>
        <div className={styles.updated}>Last updated: August 24, 2026</div>
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
        </ul>
        <p>We do not currently run any third-party analytics or advertising trackers on this site.</p>

        <h2>How we use it</h2>
        <ul>
          <li>To provide the research and reporting features you request.</li>
          <li>To operate your account, including enforcing the usage limits of your plan.</li>
          <li>To communicate with you about your account or changes to the service.</li>
        </ul>
        <p>We do not sell your personal data.</p>

        <h2>Who we share it with</h2>
        <p>
          We use <strong>Supabase</strong> as our authentication and database provider — your
          account and research data is stored there on our behalf, under their standard security
          practices. If Google sign-in is used, Google processes the authentication handshake per
          its own privacy policy. We do not share your data with other third parties beyond what's
          needed to run the service.
        </p>
        <p>
          If and when paid billing goes live, payment details will be handled directly by a
          third-party payment processor — Metis does not store your card number or billing
          credentials on its own servers.
        </p>

        <h2>Cookies</h2>
        <p>
          We currently use only the essential session cookies required to keep you signed in.
          We don't set advertising or cross-site tracking cookies.
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
