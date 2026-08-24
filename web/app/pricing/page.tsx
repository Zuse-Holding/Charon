import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import shellStyles from "../../components/marketing/MarketingShell.module.css";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing — Metis",
  description:
    "Simple, self-serve pricing. Basic at $19/mo, Pro at $49/mo, Team at $149/mo. Start free, no credit card required.",
  openGraph: {
    title: "Pricing — Metis",
    description: "Simple, self-serve pricing starting at $19/mo. Start free, no credit card required.",
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
      "25 quick profiles / mo",
      "Company, person, and product research",
      "Watchlist (5 entities)",
      "Markdown export",
    ],
    cta: "Start Basic →",
    highlight: false,
  },
  {
    tier: "PRO",
    price: "$49",
    period: "/mo",
    forWho: "For analysts, investors, and founders",
    value: "Unlimited profiles and full Deep Dive reports — the tier built for people who research as their job, not a one-off.",
    features: [
      "Everything in Basic",
      "Unlimited quick profiles",
      "Full Deep Dive reports (10 sections)",
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
    period: "/mo · 3 seats",
    forWho: "For small firms and deal teams",
    value: "Everything in Pro, shared across a workspace — so the whole team is working off the same research instead of duplicating it.",
    features: [
      "Everything in Pro",
      "3 seats included (+$40/seat after)",
      "Shared workspace",
      "Team watchlists",
      "API access",
    ],
    cta: "Start Team →",
    highlight: false,
  },
];

const COMPARE_ROWS: [string, string, string, string][] = [
  ["Quick profiles / month", "25", "Unlimited", "Unlimited"],
  ["Deep Dive reports", "—", "Full access", "Full access"],
  ["Watchlist entities", "5", "Unlimited", "Unlimited"],
  ["Knowledge Graph", "—", "Included", "Included"],
  ["Export formats", "Markdown", "Markdown + PDF", "Markdown + PDF"],
  ["Seats included", "1", "1", "3 (+$40/seat)"],
  ["Shared workspace", "—", "—", "Included"],
  ["API access", "—", "—", "Included"],
];

const FAQS = [
  {
    q: "Do I need a credit card to start?",
    a: "No. Sign up and start researching immediately — no card required for the trial.",
  },
  {
    q: "What happens when I hit my Basic profile limit?",
    a: "You'll be prompted to upgrade to Pro for unlimited profiles, or wait until your monthly limit resets. Nothing runs automatically or bills you without confirmation.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — every plan is month-to-month. Cancel from your account settings whenever you want; no contracts, no calls.",
  },
  {
    q: "What if I need more than the Team plan covers?",
    a: "Reach out at support@metisanalytic.com — we handle larger seat counts and custom needs directly.",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <h1 className={styles.title}>Simple pricing, no sales call.</h1>
        <p className={styles.sub}>
          Pick a plan, start researching in seconds. Upgrade, downgrade, or cancel whenever — every tier is self-serve.
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
              <Link
                href="/login?mode=signup"
                className={`${styles.planCta} ${plan.highlight ? styles.planCtaFeatured : ""}`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
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
        <h2 className={styles.finalCtaTitle}>Start free today.</h2>
        <p className={styles.finalCtaSub}>No credit card. No sales call. Just answers.</p>
        <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>
          Create Free Account →
        </Link>
      </section>
    </MarketingShell>
  );
}
