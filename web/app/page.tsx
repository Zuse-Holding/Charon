"use client";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";

const FEATURES = [
  {
    num: "01",
    title: "Multi-Agent Research",
    desc: "Seven specialized agents — website, news, competitors, corporate filings, leadership, and products — run simultaneously and synthesize into one clean report.",
  },
  {
    num: "02",
    title: "Deep Dive Analysis",
    desc: "10-section analyst-grade report: founding history, leadership red flags, funding history, market sizing, competitive context, and a clear strategic verdict.",
  },
  {
    num: "03",
    title: "Watchlist Intelligence",
    desc: "Track companies, people, and products over time. Staleness detection flags when entities need refreshing. Built for ongoing monitoring, not one-off lookups.",
  },
  {
    num: "04",
    title: "Knowledge Graph",
    desc: "Every entity you research connects into a queryable relationship map. Cross-entity queries across your full research history.",
  },
];

const PRICING = [
  {
    tier: "BASIC",
    price: "$19",
    period: "/mo",
    features: ["Unlimited quick profiles", "Company, person, product", "Watchlist (10 entities)", "Markdown export"],
    cta: "Get Started",
    highlight: false,
    isEnterprise: false,
  },
  {
    tier: "PRO",
    price: "$49",
    period: "/mo",
    features: ["Everything in Basic", "Deep Dive reports", "Unlimited Watchlist", "PDF export", "Knowledge Graph"],
    cta: "Start Pro →",
    highlight: true,
    isEnterprise: false,
  },
  {
    tier: "TEAM",
    price: "$149",
    period: "/mo · 3 seats",
    features: ["Everything in Pro", "Shared workspace", "Team watchlists", "API access", "+$40/seat after 3"],
    cta: "Start Team",
    highlight: false,
    isEnterprise: false,
  },
  {
    tier: "ENTERPRISE",
    price: "Custom",
    period: "let's talk",
    features: ["White-label deploy", "Custom data feeds", "Dedicated infra", "SLA & support", "Scoped to your needs"],
    cta: "Contact Us →",
    highlight: false,
    isEnterprise: true,
  },
];

export default function Landing() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <div className={styles.gridBg} />
      <div className={styles.scanline} />
      <div className={styles.orbTop} />
      <div className={styles.orbBottom} />

      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <div className={styles.logoIcon} />
          <div>
            <div className={styles.logoMark}>CHARON</div>
            <div className={styles.logoSub}>ZUSE HOLDINGS · SELENE</div>
          </div>
        </div>
        <div className={styles.navRight}>
          <button className={styles.btnGhost} onClick={() => router.push("/login")}>Sign In</button>
          <button className={styles.ctaPrimary} onClick={() => router.push("/login")}>Get Started</button>
        </div>
      </nav>

      {/* HERO */}
      <section className={styles.hero}>
        <svg className={styles.heroNodes} viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
          <circle cx="120" cy="80" r="3" fill="#ff6b2b" opacity="0.3"/>
          <circle cx="680" cy="120" r="3" fill="#ff6b2b" opacity="0.3"/>
          <circle cx="200" cy="300" r="2" fill="#00e5ff" opacity="0.2"/>
          <circle cx="600" cy="280" r="2" fill="#00e5ff" opacity="0.2"/>
          <circle cx="400" cy="60" r="3" fill="#ff6b2b" opacity="0.3"/>
          <line x1="120" y1="80" x2="400" y2="60" stroke="#ff6b2b" strokeWidth="0.5" opacity="0.2"/>
          <line x1="400" y1="60" x2="680" y2="120" stroke="#ff6b2b" strokeWidth="0.5" opacity="0.2"/>
          <line x1="200" y1="300" x2="600" y2="280" stroke="#00e5ff" strokeWidth="0.5" opacity="0.15"/>
          <line x1="120" y1="80" x2="200" y2="300" stroke="#ff6b2b" strokeWidth="0.3" opacity="0.15"/>
          <line x1="680" y1="120" x2="600" y2="280" stroke="#ff6b2b" strokeWidth="0.3" opacity="0.15"/>
        </svg>

        <div className={styles.heroBadge}>
          <span className={styles.heroBadgeDot} />
          INTELLIGENCE PLATFORM · ACTIVE
        </div>

        <h1 className={styles.heroTitle}>
          Research any entity.<br />
          <span className={styles.heroAccent}>Analyst-grade</span> results<br />
          in seconds.
        </h1>

        <p className={styles.heroSub}>
          Seven AI agents run in parallel to surface funding, leadership, competitors,
          and market signals — synthesized into one clean report.
          Between Crunchbase and PitchBook. In price and depth.
        </p>

        <div className={styles.heroCtas}>
          <button className={styles.btnHeroPrimary} onClick={() => router.push("/login")}>
            Get Started Free →
          </button>
          <button className={styles.btnHeroSecondary} onClick={() => {
            document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
          }}>
            See how it works
          </button>
        </div>

        <div className={styles.heroNote}>NO CREDIT CARD · NO SALES CALL · JUST ANSWERS</div>
      </section>

      {/* TERMINAL PREVIEW */}
      <div className={styles.previewSection}>
        <div className={styles.terminal}>
          <div className={styles.terminalHeader}>
            <div className={styles.terminalDots}>
              <span className={styles.dotRed} />
              <span className={styles.dotYellow} />
              <span className={styles.dotGreen} />
            </div>
            <div className={styles.terminalTitle}>SELENE INTELLIGENCE ENGINE · v0.1</div>
          </div>
          <div className={styles.terminalBody}>
            <div className={styles.termLine}>
              <span className={styles.termPrompt}>◈</span>
              <span className={styles.termCmd}>research --subject "Stripe" --type company</span>
            </div>
            <div className={styles.termLine}>
              <span className={styles.termComment}># Running 7 agents in parallel...</span>
            </div>
            <div className={styles.termOutput}>
              {[
                ["FOUNDED", "2010 · San Francisco, CA"],
                ["LEADERSHIP", "Patrick Collison (CEO) · John Collison (Pres)"],
                ["VALUATION", "$70B · Series I"],
                ["COMPETITORS", "PayPal · Adyen · Square · Braintree"],
                ["RISK FLAGS", "Regulatory exposure (EU) · Margin pressure"],
              ].map(([label, value]) => (
                <div key={label} className={styles.termRow}>
                  <span className={styles.termLabel}>{label}</span>
                  <span className={`${styles.termValue} ${label === "VALUATION" ? styles.termPositive : label === "RISK FLAGS" ? styles.termNegative : ""}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.termLine}>
              <span className={styles.termSuccess}>✓</span>
              <span className={styles.termDone}>Report written · 7 agents · 23s</span>
              <span className={styles.termCursor} />
            </div>
          </div>
        </div>
      </div>

      {/* STATS */}
      <div className={styles.statsBar}>
        {[
          { num: "7", label: "Parallel agents per run" },
          { num: "~30s", label: "Average research time" },
          { num: "10", label: "Sections in Deep Dive" },
        ].map((s) => (
          <div key={s.label} className={styles.statItem}>
            <span className={styles.statNum}>{s.num}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" className={styles.featuresSection}>
        <div className={styles.sectionLabel}>CAPABILITIES</div>
        <div className={styles.featuresGrid}>
          {FEATURES.map((f) => (
            <div key={f.num} className={styles.featureCard}>
              <div className={styles.featureNum}>{f.num}</div>
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className={styles.pricingSection}>
        <div className={styles.sectionLabel}>PRICING</div>
        <h2 className={styles.pricingTitle}>Between Crunchbase and PitchBook.</h2>
        <div className={styles.pricingCode}>// in price and depth</div>
        <div className={styles.pricingGrid}>
          {PRICING.map((plan) => (
            <div
              key={plan.tier}
              className={`${styles.planCard} ${plan.highlight ? styles.planFeatured : ""} ${plan.isEnterprise ? styles.planEnterprise : ""}`}
            >
              {plan.highlight && <div className={styles.planBadge}>MOST POPULAR</div>}
              <div className={`${styles.planName} ${plan.highlight ? styles.planNameHighlight : ""}`}>{plan.tier}</div>
              <div className={styles.planPrice}>{plan.price}</div>
              <div className={styles.planPeriod}>{plan.period}</div>
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
                className={`${styles.planCta} ${plan.highlight ? styles.planCtaFeatured : ""} ${plan.isEnterprise ? styles.planCtaEnterprise : ""}`}
                onClick={() => {
                  if (plan.isEnterprise) {
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
      </section>

      {/* FINAL CTA */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>Start researching in under a minute.</h2>
        <p className={styles.finalCtaSub}>No credit card. No sales call. Just answers.</p>
        <button className={styles.btnHeroPrimary} onClick={() => router.push("/login")}>
          Create Free Account →
        </button>
      </section>

      <footer className={styles.footer}>
        <span>© 2026 ZUSE HOLDINGS</span>
        <a href="mailto:hello@zuseholdings.com" className={styles.footerLink}>hello@zuseholdings.com</a>
        <span>POWERED BY SELENE</span>
      </footer>
    </div>
  );
}
