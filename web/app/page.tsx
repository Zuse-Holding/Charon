"use client";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";

const FEATURES = [
  {
    icon: "◈",
    title: "Multi-Agent Research",
    desc: "Seven specialized agents work in parallel — website, news, competitors, corporate filings, leadership, and product data — synthesized into one report.",
  },
  {
    icon: "◆",
    title: "Deep Dive Analysis",
    desc: "Go beyond the quick profile with a 10-section analyst-grade report: founding history, leadership red flags, funding, market sizing, and a clear strategic verdict.",
  },
  {
    icon: "◎",
    title: "Watchlist & Alerts",
    desc: "Track companies, people, and products over time. Get notified when something material changes — funding, leadership, or news.",
  },
  {
    icon: "◉",
    title: "Knowledge Graph",
    desc: "Every entity you research connects into a queryable relationship graph — see who's tied to who across your entire research history.",
  },
];

const PRICING = [
  {
    tier: "Basic",
    price: "$19",
    period: "/mo",
    desc: "For individuals who need fast answers.",
    features: [
      "Unlimited quick profiles",
      "Company, person & product research",
      "Watchlist (up to 10 entities)",
      "Export to Markdown",
    ],
    cta: "Get Started",
    highlight: false,
  },
  {
    tier: "Pro",
    price: "$49",
    period: "/mo",
    desc: "For operators who need real depth.",
    features: [
      "Everything in Basic",
      "Deep Dive — 10-section analyst reports",
      "Unlimited Watchlist",
      "PDF export",
      "Knowledge Graph access",
      "Priority research queue",
    ],
    cta: "Start Pro",
    highlight: true,
  },
  {
    tier: "Team",
    price: "$149",
    period: "/mo",
    desc: "For teams that research together.",
    features: [
      "Everything in Pro",
      "3 seats included ($40/seat after)",
      "Shared workspace & watchlists",
      "Team research history",
      "API access",
    ],
    cta: "Start Team",
    highlight: false,
  },
  {
    tier: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For organizations that need more.",
    features: [
      "White-label deployment",
      "Custom data feeds & integrations",
      "Dedicated research infrastructure",
      "Advanced team management",
      "SLA & dedicated support",
      "Scoped to your exact needs",
    ],
    cta: "Let's Talk →",
    highlight: false,
    isEnterprise: true,
  },
];

export default function Landing() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <span className={styles.navLogoMark}>CHARON</span>
          <span className={styles.navLogoSub}>· Powered by Selene</span>
        </div>
        <div className={styles.navRight}>
          <button className={styles.navCta} onClick={() => router.push("/login")}>
            Sign In
          </button>
          <button className={styles.ctaPrimary} onClick={() => router.push("/login")}>
            Get Started
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.heroBadge}>ZUSE HOLDINGS · INTELLIGENCE PLATFORM</div>
        <h1 className={styles.heroTitle}>
          Business intelligence research,<br />without the enterprise price tag.
        </h1>
        <p className={styles.heroSub}>
          Charon researches companies, people, and products in seconds — pulling
          funding, leadership, competitors, and news into one clean report.
          Built for founders, operators, and BD teams who need real answers fast.
        </p>
        <div className={styles.heroCtas}>
          <button className={styles.ctaPrimary} onClick={() => router.push("/login")}>
            Get Started Free →
          </button>
          <button className={styles.ctaSecondary} onClick={() => {
            document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
          }}>
            See how it works
          </button>
        </div>
      </section>

      {/* DEMO PREVIEW */}
      <section className={styles.previewSection}>
        <div className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <div className={styles.previewDots}>
              <span /><span /><span />
            </div>
            <span className={styles.previewUrl}>charon.zuseholdings.com</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewSearch}>
              <span className={styles.previewSearchDot} />
              <span className={styles.previewSearchText}>Researching "Stripe"...</span>
            </div>
            <div className={styles.previewResult}>
              <div className={styles.previewResultRow}>
                <span className={styles.previewLabel}>FOUNDED</span>
                <span>2010</span>
              </div>
              <div className={styles.previewResultRow}>
                <span className={styles.previewLabel}>LEADERSHIP</span>
                <span>Patrick Collison, John Collison</span>
              </div>
              <div className={styles.previewResultRow}>
                <span className={styles.previewLabel}>VALUATION</span>
                <span>$70B</span>
              </div>
              <div className={styles.previewResultRow}>
                <span className={styles.previewLabel}>COMPETITORS</span>
                <span>PayPal, Adyen, Square</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="how-it-works" className={styles.featuresSection}>
        <div className={styles.sectionLabel}>WHAT YOU GET</div>
        <div className={styles.featuresGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className={styles.pricingSection}>
        <div className={styles.sectionLabel}>PRICING</div>
        <h2 className={styles.pricingTitle}>
          Between Crunchbase and PitchBook.<br />In price and depth.
        </h2>
        <p className={styles.pricingSub}>
          Crunchbase gives you shallow profiles at $49/mo.
          PitchBook gives you depth at $20,000+/yr.
          Charon gives you analyst-grade research at a price that makes sense.
        </p>
        <div className={styles.pricingGrid}>
          {PRICING.map((plan) => (
            <div
              key={plan.tier}
              className={`${styles.pricingCard} ${plan.highlight ? styles.pricingHighlight : ""} ${(plan as any).isEnterprise ? styles.pricingEnterprise : ""}`}
            >
              {plan.highlight && (
                <div className={styles.popularBadge}>MOST POPULAR</div>
              )}
              <div className={styles.planTier}>{plan.tier}</div>
              <div className={styles.planPriceRow}>
                <span className={styles.planPrice}>{plan.price}</span>
                {plan.period && <span className={styles.planPeriod}>{plan.period}</span>}
              </div>
              <div className={styles.planDesc}>{plan.desc}</div>
              <div className={styles.planDivider} />
              <ul className={styles.planFeatures}>
                {plan.features.map((f) => (
                  <li key={f} className={styles.planFeature}>
                    <span className={styles.planCheck}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`${styles.planCta} ${plan.highlight ? styles.planCtaHighlight : ""} ${(plan as any).isEnterprise ? styles.planCtaEnterprise : ""}`}
                onClick={() => {
                  if ((plan as any).isEnterprise) {
                    window.location.href = "mailto:hello@zuseholdings.com?subject=Charon Enterprise";
                  } else {
                    router.push("/login");
                  }
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
        <div className={styles.pricingNote}>
          All plans include a free trial period. No credit card required to start.
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>Start researching in under a minute.</h2>
        <p className={styles.finalCtaSub}>No credit card. No sales call. Just answers.</p>
        <button className={styles.ctaPrimary} onClick={() => router.push("/login")}>
          Create Free Account →
        </button>
      </section>

      <footer className={styles.footer}>
        <span>© 2026 Zuse Holdings</span>
        <span>
          <a href="mailto:hello@zuseholdings.com" className={styles.footerLink}>
            hello@zuseholdings.com
          </a>
        </span>
        <span>Powered by Selene</span>
      </footer>
    </div>
  );
}
