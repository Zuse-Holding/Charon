"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

const SECTORS = [
  { id: "tech",     icon: "◈", label: "Tech & Software" },
  { id: "fintech",  icon: "◆", label: "Fintech & Payments" },
  { id: "ai",       icon: "◉", label: "AI & Machine Learning" },
  { id: "health",   icon: "⊕", label: "Healthcare" },
  { id: "gaming",   icon: "⬡", label: "Gaming" },
  { id: "defense",  icon: "◎", label: "Defense & Aerospace" },
  { id: "climate",  icon: "⊞", label: "Climate & Energy" },
  { id: "consumer", icon: "◇", label: "Consumer & Retail" },
];

interface FeedItem {
  headline: string;
  summary: string;
  url: string;
  source: string;
  company: string | null;
}

interface SectorFeed {
  sector: string;
  label: string;
  items: FeedItem[];
  generatedAt: string;
}

type SectorState = "loading" | "loaded" | "error";

export default function IntelFeed() {
  const router = useRouter();
  const [feeds, setFeeds]   = useState<Record<string, SectorFeed>>({});
  const [states, setStates] = useState<Record<string, SectorState>>({});
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const loadSector = useCallback(async (sectorId: string) => {
    setStates(prev => ({ ...prev, [sectorId]: "loading" }));
    try {
      const res = await fetch(`/api/intel-feed?sector=${sectorId}`);
      if (!res.ok) throw new Error("Failed");
      const data: SectorFeed = await res.json();
      setFeeds(prev => ({ ...prev, [sectorId]: data }));
      setStates(prev => ({ ...prev, [sectorId]: "loaded" }));
    } catch {
      setStates(prev => ({ ...prev, [sectorId]: "error" }));
    }
  }, []);

  useEffect(() => {
    // Load all sectors in parallel
    SECTORS.forEach(s => loadSector(s.id));
    setLastUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
  }, [loadSector]);

  function handleResearch(company: string) {
    router.push(`/app?research=${encodeURIComponent(company)}`);
  }

  const loadedCount = Object.values(states).filter(s => s === "loaded").length;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>

          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>Intelligence Feed</h1>
              <div className={styles.subtitle}>
                Live business signals across 8 sectors · Updated {lastUpdated || "now"}
              </div>
            </div>
            <div className={styles.headerRight}>
              <div className={styles.loadProgress}>
                <span className={styles.loadNum}>{loadedCount}</span>
                <span className={styles.loadDen}>/ {SECTORS.length}</span>
              </div>
              <button
                className={styles.refreshBtn}
                onClick={() => {
                  setFeeds({});
                  setStates({});
                  SECTORS.forEach(s => loadSector(s.id));
                  setLastUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
                }}
              >
                ↺ Refresh
              </button>
            </div>
          </div>

          <div className={styles.grid}>
            {SECTORS.map(sector => {
              const state = states[sector.id] ?? "loading";
              const feed  = feeds[sector.id];

              return (
                <div key={sector.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardIcon}>{sector.icon}</span>
                    <span className={styles.cardLabel}>{sector.label}</span>
                    {state === "loading" && <span className={styles.cardLoading} />}
                    {state === "error"   && <span className={styles.cardError}>failed</span>}
                  </div>

                  {state === "loading" && (
                    <div className={styles.skeletons}>
                      {[1,2,3].map(i => (
                        <div key={i} className={styles.skeleton}>
                          <div className={styles.skeletonLine} style={{ width: `${70 + i * 8}%` }} />
                          <div className={styles.skeletonLine} style={{ width: "50%", opacity: 0.5 }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {state === "loaded" && feed && (
                    <div className={styles.items}>
                      {feed.items.map((item, i) => (
                        <div key={i} className={styles.item}>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.itemHeadline}
                          >
                            {item.headline}
                          </a>
                          {item.summary && (
                            <div className={styles.itemSummary}>
                              {item.summary.slice(0, 120)}{item.summary.length > 120 ? "..." : ""}
                            </div>
                          )}
                          <div className={styles.itemFooter}>
                            {item.source && (
                              <span className={styles.itemSource}>{item.source}</span>
                            )}
                            {item.company && (
                              <button
                                className={styles.researchBtn}
                                onClick={() => handleResearch(item.company!)}
                              >
                                Research {item.company} →
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {feed.items.length === 0 && (
                        <div className={styles.emptyFeed}>No signals found</div>
                      )}
                    </div>
                  )}

                  {state === "error" && (
                    <div className={styles.errorState}>
                      <button className={styles.retryBtn} onClick={() => loadSector(sector.id)}>
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </main>
    </div>
  );
}
