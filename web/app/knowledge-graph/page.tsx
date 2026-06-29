"use client";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

const RELATIONSHIP_EXAMPLES = [
  { from: "Patrick Collison", rel: "CO-FOUNDED", to: "Stripe" },
  { from: "Stripe", rel: "COMPETES WITH", to: "PayPal" },
  { from: "Stripe", rel: "PARTNERED WITH", to: "Google" },
  { from: "Stripe", rel: "ACQUIRED", to: "Paystack" },
  { from: "John Collison", rel: "CO-FOUNDED", to: "Stripe" },
];

const PLANNED_FEATURES = [
  {
    icon: "◈",
    title: "Entity Relationship Mapping",
    desc: "Automatically detect and store relationships between researched companies, people, and products — founders, competitors, acquisitions, partnerships.",
  },
  {
    icon: "⬡",
    title: "Visual Graph Explorer",
    desc: "Interactive node-link diagram where you can click any entity to expand its connections and navigate your research history visually.",
  },
  {
    icon: "◎",
    title: "Cross-Entity Intelligence",
    desc: "Ask questions that span entities — \"Who are the investors backing both Stripe and Hims & Hers?\" — by traversing the relationship graph.",
  },
  {
    icon: "⊞",
    title: "Ecosystem Mapping",
    desc: "Map entire market segments — all telehealth competitors, all Stripe investors, all companies founded by ex-Google executives — in a single view.",
  },
];

export default function KnowledgeGraph() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>

          <div className={styles.hero}>
            <div className={styles.heroIcon}>◉</div>
            <h1 className={styles.heroTitle}>Knowledge Graph</h1>
            <div className={styles.heroBadge}>COMING SOON</div>
            <p className={styles.heroDesc}>
              Every company, person, and product you research gets connected into
              a queryable intelligence graph — turning isolated reports into a
              living map of relationships, patterns, and market dynamics.
            </p>
          </div>

          <div className={styles.previewSection}>
            <div className={styles.sectionLabel}>RELATIONSHIP PREVIEW</div>
            <div className={styles.graphPreview}>
              {RELATIONSHIP_EXAMPLES.map((rel, i) => (
                <div key={i} className={styles.relRow}>
                  <span className={styles.relNode}>{rel.from}</span>
                  <span className={styles.relArrow}>
                    <span className={styles.relLabel}>{rel.rel}</span>
                    <span className={styles.relLine}>──────▶</span>
                  </span>
                  <span className={styles.relNode}>{rel.to}</span>
                </div>
              ))}
              <div className={styles.previewNote}>
                Based on your existing research history — built automatically as you research.
              </div>
            </div>
          </div>

          <div className={styles.featuresSection}>
            <div className={styles.sectionLabel}>PLANNED CAPABILITIES</div>
            <div className={styles.featuresGrid}>
              {PLANNED_FEATURES.map((f) => (
                <div key={f.title} className={styles.featureCard}>
                  <div className={styles.featureIcon}>{f.icon}</div>
                  <div className={styles.featureTitle}>{f.title}</div>
                  <div className={styles.featureDesc}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.timeline}>
            <div className={styles.sectionLabel}>ROADMAP</div>
            <div className={styles.timelineItems}>
              <div className={`${styles.timelineItem} ${styles.done}`}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Research Agents</span>
                <span className={styles.tlStatus}>LIVE</span>
              </div>
              <div className={`${styles.timelineItem} ${styles.done}`}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Reports + Watchlist</span>
                <span className={styles.tlStatus}>LIVE</span>
              </div>
              <div className={styles.timelineItem}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Entity extraction + relationship detection</span>
                <span className={styles.tlStatus}>Q3 2026</span>
              </div>
              <div className={styles.timelineItem}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Graph storage + querying</span>
                <span className={styles.tlStatus}>Q3 2026</span>
              </div>
              <div className={styles.timelineItem}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Visual graph explorer</span>
                <span className={styles.tlStatus}>Q4 2026</span>
              </div>
              <div className={styles.timelineItem}>
                <span className={styles.tlDot} />
                <span className={styles.tlLabel}>Cross-entity intelligence queries</span>
                <span className={styles.tlStatus}>Q4 2026</span>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
