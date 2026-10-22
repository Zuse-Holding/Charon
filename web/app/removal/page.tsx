import type { Metadata } from "next";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import styles from "../privacy/legal.module.css";

export const metadata: Metadata = {
  title: "Removal requests — Metis",
  description: "Named in a Metis report? Ask us to correct it or to leave you out of future reports.",
};

/**
 * Public, no account needed: the people and small businesses that appear
 * in reports are mostly not Metis users. Signed-in users can add their own
 * identifiers at /settings/self-exclusion (confirmed by email); everyone
 * else writes to support, who review each request by hand.
 */

const REQUEST_BODY = [
  "Your name:",
  "Business name (if this is about a business):",
  "What you want: removal from future reports / a correction",
  "What's wrong or what should be removed (a link to the source helps):",
  "",
  "We'll reply to this address. Please don't send ID documents or your date of birth by email.",
].join("\n");

const MAILTO = `mailto:support@metisanalytic.com?subject=${encodeURIComponent("Removal request")}&body=${encodeURIComponent(REQUEST_BODY)}`;

export default function RemovalPage() {
  return (
    <MarketingShell>
      <div className={styles.header}>
        <h1 className={styles.title}>Removal requests</h1>
      </div>

      <div className={styles.body}>
        <p>
          Metis builds research reports from public sources: company websites, business listings,
          news and public records. If you or your business appear in a report and something is
          wrong, or you&apos;d rather not appear at all, tell us here. You don&apos;t need an account.
        </p>

        <h2>Ask for a removal or a correction</h2>
        <p>
          Email <a href={MAILTO}>support@metisanalytic.com</a> with the subject &ldquo;Removal
          request&rdquo;. Include your name, the business name if it&apos;s about a business, and what
          should be removed or corrected. A link to the source helps. Please don&apos;t send ID
          documents or your date of birth by email.
        </p>
        <p>
          A person reviews every request and replies by email. Removals apply to reports run after
          we act on the request. We can&apos;t change the public sources themselves, so a correction to
          the original website or record is still worth asking for there.
        </p>

        <h2>If you have a Metis account</h2>
        <p>
          You can add your own email address, or your name and date of birth, under{" "}
          <a href="/settings/self-exclusion">Settings → Self-exclusion</a>. Once you confirm by email,
          searches on them return nothing and Metis leaves them out of its automated research.
        </p>

        <h2>Found a mistake as a Metis user?</h2>
        <p>
          Use &ldquo;Something wrong in this report?&rdquo; at the bottom of the report. It goes
          straight to the team with the report attached.
        </p>
      </div>
    </MarketingShell>
  );
}
