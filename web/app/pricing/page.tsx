import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import shellStyles from "../../components/marketing/MarketingShell.module.css";
import { PlanCheckoutButton } from "../../components/marketing/PlanCheckoutButton";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing — Metis",
  description:
    "Simple pricing. Basic at $19/mo and Pro at $49/mo, self-serve with no sales call. Team at $149/mo by email.",
  openGraph: {
    title: "Pricing — Metis",
    description: "Simple, self-serve pricing starting at $19/mo. No sales call required.",
    url: "https://metisanalytic.com/pricing",
    type: "website",
  },
};

const PLANS = [
  {
    tier: "BASIC",
    price: "$19",
    period: "/mo",
    forWho: "For individuals and casual research",
    value: "25 quick profiles a month — enough to check out a company, person, or product without committing to more.",
    features: [
      "25 quick profiles a month",
      "Up to 10 per 8-hour window",
      "Company, person, and product research",
      "Watchlist (5 entities)",
      "Markdown export",
    ],
    cta: "Start Basic →",
    highlight: false,
  },
  {
    // Caps below mirror PRO_MONTHLY_RESEARCH_LIMIT (300) and
    // PRO_MONTHLY_DEEP_DIVE_LIMIT (50) in server/agent-server.ts; change both together.
    tier: "PRO",
    price: "$49",
    period: "/mo",
    forWho: "For analysts, investors, and founders",
    value: "300 profiles and 50 full Deep Dive reports a month — the tier built for people who research as their job, not a one-off.",
    features: [
      "Everything in Basic",
      "300 quick profiles a month",
      "Up to 50 per 8-hour window",
      "50 Deep Dive reports a month (10 sections)",
      "Unlimited Watchlist",
      "PDF export",
      "Knowledge Graph access",
    ],
    cta: "Start Pro →",
    highlight: true,
  },
  {
    tier: "TEAM",
    price: "$149",
    period: "/mo",
    forWho: "For small firms and deal teams",
    value: "Pro with higher limits, for teams that run research every day.",
    features: [
      "Pro features with higher limits",
      "200 quick profiles per 8-hour window",
      "20 Deep Dive reports per 8-hour window",
      "No monthly cap",
      "Watchlist (50 entities)",
    ],
    cta: "Contact Us →",
    highlight: false,
    contactOnly: true,
  },
];

const COMPARE_ROWS: [string, string, string, string][] = [
  ["Quick profiles a month", "25", "300", "No cap"],
  ["Quick profiles per 8-hour window", "10", "50", "200"],
  ["Deep Dive reports a month", "—", "50", "No cap"],
  ["Deep Dive reports per 8-hour window", "—", "No cap", "20"],
  ["Watchlist entities", "5", "Unlimited", "50"],
  ["Knowledge Graph", "—", "Included", "Included"],
  ["Export formats", "Markdown", "Markdown + PDF", "Markdown + PDF"],
];

const FAQS = [
  {
    q: "How does the 8-hour window work?",
    a: "Your first report or Deep Dive starts an 8-hour window. Each plan gets a set number of runs inside it, and the count resets when the window ends. Your next run after that starts a new one. The sidebar shows what's left and when it resets.",
  },
  {
    q: "What happens when I hit my Basic profile limit?",
    a: "You'll be prompted to upgrade to Pro for 300 profiles a month, or wait until your monthly limit resets. Nothing runs automatically or bills you without confirmation.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — every plan is month-to-month. Cancel from your account settings whenever you want; no contracts, no calls.",
  },
  {
    q: "What if I need more than the Team plan covers?",
    a: "Reach out at support@metisanalytic.com — we handle higher limits and custom needs directly.",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <h1 className={styles.title}>Simple pricing, no sales call.</h1>
        <p className={styles.sub}>
          Pick a plan and start researching right away. Upgrade, downgrade, or cancel whenever — Basic and Pro are self-serve.
        </p>
      </section>

      <section className={styles.pricingSection}>
        <div className={styles.pricingGrid}>
          {PLANS.map((plan) => (
            <div key={plan.tier} className={`${styles.planCard} ${plan.highlight ? styles.planFeatured : ""}`}>
              {plan.highlight && <div className={styles.planBadge}>MOST POPULAR</div>}
              <div className={`${styles.planName} ${plan.highlight ? styles.planNameHighlight : ""}`}>{plan.tier}</div>
              <div className={styles.planFor}>{plan.forWho}</div>
              <div className={styles.planPrice}>{plan.price}</div>
              <div className={styles.planPeriod}>{plan.period}</div>
              <div className={styles.planDivider} />
              <p className={styles.planValue}>{plan.value}</p>
              <ul className={styles.planFeatures}>
                {plan.features.map((f) => (
                  <li key={f} className={styles.planFeature}>
                    <span className={styles.planCheck}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {plan.tier === "BASIC" || plan.tier === "PRO" ? (
                <PlanCheckoutButton
                  plan={plan.tier === "BASIC" ? "basic" : "pro"}
                  label={plan.cta}
                  className={`${styles.planCta} ${plan.highlight ? styles.planCtaFeatured : ""}`}
                />
              ) : (
                // Team isn't self-serve (task 1.6) — no signup link
                // pretending to be a purchase; a real contact path instead.
                <a
                  href="mailto:support@metisanalytic.com?subject=Metis Team"
                  className={`${styles.planCta} ${plan.highlight ? styles.planCtaFeatured : ""}`}
                >
                  {plan.cta}
                </a>
              )}
            </div>
          ))}
        </div>
        <p className={styles.finePrint}>
          The 8-hour window starts with your first run and resets 8 hours later, so a full work day never runs into tomorrow&apos;s limit.<br />
          Refunds within 7 days of your first charge, on request.<br />
          Need higher limits? Email <a href="mailto:support@metisanalytic.com">support@metisanalytic.com</a>.
        </p>
      </section>

      <section className={styles.compareSection}>
        <h2 className={styles.compareTitle}>Compare plans</h2>
        <div className={styles.compareWrap}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th></th>
                <th>Basic</th>
                <th className={styles.featured}>Pro</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label, basic, pro, team]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{basic}</td>
                  <td>{pro}</td>
                  <td>{team}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.faqSection}>
        <h2 className={styles.faqTitle}>Pricing FAQ</h2>
        {FAQS.map((f) => (
          <div key={f.q} className={styles.faqItem}>
            <div className={styles.faqQ}>{f.q}</div>
            <div className={styles.faqA}>{f.a}</div>
          </div>
        ))}
      </section>

      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>Start researching today.</h2>
        <p className={styles.finalCtaSub}>No sales call. Just answers.</p>
        <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>
          Create account →
        </Link>
      </section>
    </MarketingShell>
  );
}
