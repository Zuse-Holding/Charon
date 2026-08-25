import type { Metadata } from "next";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import styles from "../privacy/legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service — Metis",
  description: "The terms that govern use of Metis.",
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <div className={styles.header}>
        <div className={styles.draftBadge}>DRAFT — PENDING LEGAL REVIEW</div>
        <h1 className={styles.title}>Terms of Service</h1>
        <div className={styles.updated}>Last updated: August 24, 2026</div>
      </div>

      <div className={styles.body}>
        <p>
          This is a working draft of our terms. It has not yet been reviewed by counsel and
          should not be treated as a final, binding statement until that review is complete.
        </p>

        <h2>Using Metis</h2>
        <p>
          By creating an account, you agree to use Metis only for lawful research purposes. You're
          responsible for keeping your account credentials secure and for activity that happens
          under your account.
        </p>
        <p>You agree not to:</p>
        <ul>
          <li>Attempt to scrape, bulk-extract, or resell Metis's underlying data or reports.</li>
          <li>Use the service to harass, stalk, or build dossiers on private individuals outside its intended research use.</li>
          <li>Attempt to circumvent your plan's usage limits or access another account without authorization.</li>
        </ul>

        <h2>Plans and billing</h2>
        <p>
          Metis is offered on self-serve monthly plans (Basic, Pro, Team) at the pricing listed on{" "}
          our <a href="/pricing">pricing page</a>. Plans are billed monthly and can be canceled at
          any time from your account settings — no contracts. Once paid billing is active, a
          third-party payment processor will handle your payment details directly.
        </p>

        <h2>Not investment, legal, or financial advice</h2>
        <p>
          Metis synthesizes information from public sources — news, filings, company websites, and
          similar — into research reports. We don't independently verify every underlying source,
          and reports can be incomplete or contain errors. <strong>Nothing Metis produces is
          investment, legal, financial, or professional advice</strong>, and it should not be the
          sole basis for a business, investment, or legal decision. You're responsible for
          independently verifying anything you rely on.
        </p>

        <h2>Intellectual property</h2>
        <p>
          Metis and its underlying technology belong to us. The specific reports and research
          outputs generated for your account are yours to use for your own purposes, subject to
          the restrictions above.
        </p>

        <h2>Service availability</h2>
        <p>
          We aim to keep Metis available and accurate, but we don't guarantee uninterrupted access
          or that every report will be complete or error-free. The service is provided "as is."
        </p>

        <h2>Termination</h2>
        <p>
          You can cancel your account at any time. We may suspend or terminate accounts that
          violate these terms, including the usage restrictions above.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          If these terms change materially, we'll update the date at the top of this page and,
          where appropriate, notify account holders directly.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a href="mailto:support@metisanalytic.com">support@metisanalytic.com</a>.
        </p>
      </div>
    </MarketingShell>
  );
}
