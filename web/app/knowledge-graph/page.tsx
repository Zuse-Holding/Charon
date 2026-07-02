"use client";
import { useEffect, useState } from "react";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

interface Entity {
  id: string;
  name: string;
  type: "company" | "person" | "product";
  first_seen_at: string;
}

interface Relationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
}

const PLANNED_FEATURES = [
  { icon: "◈", title: "Entity Relationship Mapping", desc: "Automatically detect and store relationships between researched companies, people, and products." },
  { icon: "⬡", title: "Visual Graph Explorer", desc: "Interactive node-link diagram where you can click any entity to expand its connections." },
  { icon: "◎", title: "Cross-Entity Intelligence", desc: 'Ask questions across entities — "Who invested in both Stripe and Hims?" — by traversing the graph.' },
  { icon: "⊞", title: "Ecosystem Mapping", desc: "Map entire market segments — all telehealth competitors, all Stripe investors — in a single view." },
];

const TYPE_COLORS: Record<string, string> = {
  company: "var(--orange)",
  person: "var(--cyan)",
  product: "var(--green)",
};

export default function KnowledgeGraph() {
  const [entities, setEntities]           = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [eRes, rRes] = await Promise.all([
          fetch("/api/knowledge-graph/entities"),
          fetch("/api/knowledge-graph/relationships"),
        ]);
        if (eRes.ok) setEntities(await eRes.json());
        if (rRes.ok) setRelationships(await rRes.json());
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const companiesCount = entities.filter(e => e.type === "company").length;
  const peopleCount    = entities.filter(e => e.type === "person").length;
  const productsCount  = entities.filter(e => e.type === "product").length;

  const entityMap = new Map(entities.map(e => [e.id, e]));

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>

          <div className={styles.hero}>
            <div className={styles.heroIcon}>◉</div>
            <h1 className={styles.heroTitle}>Knowledge Graph</h1>
            <div className={styles.heroBadge}>PHASE 1 ACTIVE — COLLECTING DATA</div>
            <p className={styles.heroDesc}>
              Every entity you research is being added to a queryable intelligence graph.
              Relationships, connections, and patterns are building automatically in the background.
            </p>
          </div>

          {/* LIVE STATS */}
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <div className={styles.statNum} style={{ color: "var(--orange)" }}>{loading ? "—" : entities.length}</div>
              <div className={styles.statLabel}>Total Entities</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum} style={{ color: "var(--orange)" }}>{loading ? "—" : companiesCount}</div>
              <div className={styles.statLabel}>Companies</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum} style={{ color: "var(--cyan)" }}>{loading ? "—" : peopleCount}</div>
              <div className={styles.statLabel}>People</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum} style={{ color: "var(--green)" }}>{loading ? "—" : productsCount}</div>
              <div className={styles.statLabel}>Products</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{loading ? "—" : relationships.length}</div>
              <div className={styles.statLabel}>Relationships</div>
            </div>
          </div>

          {/* ENTITY LIST */}
          {entities.length > 0 && (
            <div className={styles.entitiesSection}>
              <div className={styles.sectionLabel}>EXTRACTED ENTITIES</div>
              <div className={styles.entityList}>
                {entities.slice(0, 30).map(entity => (
                  <div key={entity.id} className={styles.entityChip} style={{ borderColor: TYPE_COLORS[entity.type] + "40" }}>
                    <span className={styles.entityDot} style={{ background: TYPE_COLORS[entity.type] }} />
                    <span className={styles.entityName}>{entity.name}</span>
                    <span className={styles.entityType}>{entity.type}</span>
                  </div>
                ))}
                {entities.length > 30 && (
                  <div className={styles.entityChip} style={{ borderColor: "var(--border)" }}>
                    <span className={styles.entityName} style={{ color: "var(--muted)" }}>+{entities.length - 30} more</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RELATIONSHIPS */}
          {relationships.length > 0 && (
            <div className={styles.entitiesSection}>
              <div className={styles.sectionLabel}>DETECTED RELATIONSHIPS</div>
              <div className={styles.relList}>
                {relationships.slice(0, 15).map(rel => {
                  const from = entityMap.get(rel.from_entity_id);
                  const to   = entityMap.get(rel.to_entity_id);
                  if (!from || !to) return null;
                  return (
                    <div key={rel.id} className={styles.relRow}>
                      <span className={styles.relNode} style={{ color: TYPE_COLORS[from.type] }}>{from.name}</span>
                      <span className={styles.relType}>{rel.relationship_type.replace(/_/g, " ")}</span>
                      <span className={styles.relNode} style={{ color: TYPE_COLORS[to.type] }}>{to.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {entities.length === 0 && !loading && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>◉</div>
              <div className={styles.emptyTitle}>No entities yet</div>
              <div className={styles.emptyText}>Run some research to start building your knowledge graph. Entities and relationships are extracted automatically after each run.</div>
            </div>
          )}

          {/* PLANNED FEATURES */}
          <div className={styles.featuresSection}>
            <div className={styles.sectionLabel}>COMING NEXT</div>
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

          {/* ROADMAP */}
          <div className={styles.timeline}>
            <div className={styles.sectionLabel}>ROADMAP</div>
            <div className={styles.timelineItems}>
              {[
                { label: "Research Agents", status: "LIVE", done: true },
                { label: "Reports + Watchlist", status: "LIVE", done: true },
                { label: "Entity extraction + relationship detection", status: "LIVE", done: true },
                { label: "Graph storage + querying", status: "LIVE", done: true },
                { label: "Visual graph explorer", status: "Q3 2026", done: false },
                { label: "Cross-entity intelligence queries", status: "Q4 2026", done: false },
              ].map((item, i) => (
                <div key={i} className={`${styles.timelineItem} ${item.done ? styles.done : ""}`}>
                  <span className={styles.tlDot} />
                  <span className={styles.tlLabel}>{item.label}</span>
                  <span className={styles.tlStatus}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
