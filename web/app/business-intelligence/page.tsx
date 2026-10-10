"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import { startCheckout, type SellablePlan } from "../../lib/checkout";
import styles from "./landing.module.css";

// Scroll-triggered fade-in. Sections render visible; only ones still below
// the fold get hidden, and only once JS runs and the visitor hasn't asked for
// reduced motion — so crawlers, link previews, headless screenshots and fast
// scrollers never see a blank page.
function useScrollFade() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    document.querySelectorAll(`.${styles.fadeIn}`).forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.classList.add(styles.fadePending);
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);
}

// An excerpt of a real report (reports/stripe.md, generated 2026-10-05),
// copied as written, including the section the pipeline couldn't source.
const SAMPLE_REPORT = {
  subject: "Stripe",
  generated: "Oct 5, 2026",
  sections: [
    {
      title: "Company overview",
      rows: [["Founded", "2010"], ["Headquarters", "San Francisco and Dublin"], ["Industry", "Financial Infrastructure"]],
      sources: ["stripe.com", "stripe.com/guides", "stripe.com/payments"],
    },
    {
      title: "Competitors",
      rows: [["Named", "PayPal · Square · Adyen · Braintree · Checkout.com"]],
      sources: ["paddle.com", "tipalti.com", "memberful.com", "attrock.com", "reddit.com"],
    },
    {
      title: "Risks",
      rows: [["", "Direct competition from established payment processors like Adyen, PayPal, and Square threatens market share in financial infrastructure."]],
      sources: [],
    },
  ],
};

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
    features: ["25 quick profiles/mo", "Company, person, product", "Watchlist (5 entities)", "Markdown export"],
    cta: "Get Started",
    highlight: false,
  },
  {
    tier: "PRO",
    price: "$49",
    period: "/mo",
    features: ["Everything in Basic", "Deep Dive reports", "Unlimited Watchlist", "PDF export", "Knowledge Graph"],
    cta: "Start Pro →",
    highlight: true,
  },
  {
    tier: "TEAM",
    price: "$149",
    period: "/mo",
    features: ["Pro with higher limits", "200 quick profiles a day", "20 Deep Dives a day", "Team features in development"],
    cta: "Contact Us →",
    highlight: false,
    contactOnly: true,
  },
];

export default function Landing() {
  const router = useRouter();
  useScrollFade();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handlePlanClick(plan: (typeof PRICING)[number]) {
    // Team isn't self-serve (task 1.6) — a real contact path, not a
    // signup link pretending to be a purchase.
    if ("contactOnly" in plan && plan.contactOnly) {
      window.location.href = "mailto:support@metisanalytic.com?subject=Metis Team";
      return;
    }
    if (plan.tier === "BASIC" || plan.tier === "PRO") {
      setCheckoutError(null);
      const result = await startCheckout(plan.tier.toLowerCase() as SellablePlan, router);
      if (result.error) setCheckoutError(result.error);
    }
  }

  return (
    <MarketingShell>
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
          METIS INTELLIGENCE
        </div>

        <h1 className={styles.heroTitle}>
          Research any company, person or product.<br />
          <span className={styles.heroAccent}>Every section shows its sources.</span>
        </h1>

        <p className={styles.heroSub}>
          Seven AI agents run in parallel to surface funding, leadership, competitors,
          and market signals — synthesized into one clean report.
          Between Crunchbase and PitchBook. In price and depth.
        </p>

        <div className={styles.heroCtas}>
          <button className={styles.btnHeroPrimary} onClick={() => router.push("/login?mode=signup")}>
            Get Started Free →
          </button>
          <button className={styles.btnHeroSecondary} onClick={() => {
            document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
          }}>
            See how it works
          </button>
        </div>

        <div className={styles.heroNote}>NO SALES CALL · JUST ANSWERS</div>
      </section>

      {/* SAMPLE REPORT */}
      <div className={`${styles.previewSection} ${styles.fadeIn}`}>
        <div className={styles.terminal}>
          <div className={styles.terminalHeader}>
            <div className={styles.terminalTitle}>EXAMPLE · EXCERPT FROM A REAL REPORT</div>
          </div>
          <div className={styles.terminalBody}>
            <div className={styles.sampleSubject}>
              <span>{SAMPLE_REPORT.subject} · company report</span>
              <span className={styles.sampleDate}>Generated {SAMPLE_REPORT.generated}</span>
            </div>
            {SAMPLE_REPORT.sections.map((section) => (
              <div key={section.title} className={styles.termOutput}>
                <div className={styles.sampleSection}>{section.title}</div>
                {section.rows.map(([label, value]) => (
                  <div key={value} className={styles.termRow}>
                    {label && <span className={styles.termLabel}>{label.toUpperCase()}</span>}
                    <span className={styles.termValue}>{value}</span>
                  </div>
                ))}
                {section.sources.length > 0 ? (
                  <div className={styles.sampleSources}>
                    {section.sources.length} sources · {section.sources.join(" · ")}
                  </div>
                ) : (
                  <div className={styles.sampleUnverified}>Unverified — no sources recorded for this section.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* STATS */}
      <div className={`${styles.statsBar} ${styles.fadeIn}`}>
        {[
          { num: "7", label: "Parallel agents per run" },
          { num: "10", label: "Sections in Deep Dive" },
          { num: "3", label: "Research types: company, person, product" },
        ].map((s) => (
          <div key={s.label} className={styles.statItem}>
            <span className={styles.statNum}>{s.num}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <section id="features" className={`${styles.featuresSection} ${styles.fadeIn}`}>
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
      <section className={`${styles.pricingSection} ${styles.fadeIn}`}>
        <div className={styles.sectionLabel}>PRICING</div>
        <h2 className={styles.pricingTitle}>Between Crunchbase and PitchBook.</h2>
        <div className={styles.pricingCode}>// in price and depth</div>
        <div className={styles.pricingGrid}>
          {PRICING.map((plan) => (
            <div
              key={plan.tier}
              className={`${styles.planCard} ${plan.highlight ? styles.planFeatured : ""} ${"contactOnly" in plan && plan.contactOnly ? styles.planEnterprise : ""}`}
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
                className={`${styles.planCta} ${plan.highlight ? styles.planCtaFeatured : ""} ${"contactOnly" in plan && plan.contactOnly ? styles.planCtaEnterprise : ""}`}
                onClick={() => handlePlanClick(plan)}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
        {checkoutError && <p className={styles.checkoutError}>{checkoutError}</p>}
        <p className={styles.higherLimitsNote}>
          Need higher limits? Email <a href="mailto:support@metisanalytic.com">support@metisanalytic.com</a>.
        </p>
        <Link href="/pricing" className={styles.pricingDetailLink}>See full pricing details →</Link>
      </section>

      {/* FINAL CTA */}
      <section className={`${styles.finalCta} ${styles.fadeIn}`}>
        <h2 className={styles.finalCtaTitle}>Run your first report on a free account.</h2>
        <p className={styles.finalCtaSub}>No sales call. Just answers.</p>
        <button className={styles.btnHeroPrimary} onClick={() => router.push("/login?mode=signup")}>
          Create Free Account →
        </button>
      </section>
    </MarketingShell>
  );
}
