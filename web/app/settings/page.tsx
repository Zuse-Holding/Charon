"use client";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

const SETTINGS = [
  {
    section: "LLM PROVIDER",
    items: [
      { label: "Provider", value: "Groq (llama-3.1-8b-instant)", status: "active" },
      { label: "Fallback", value: "Ollama (llama3.1:8b)", status: "standby" },
      { label: "Cost per run", value: "~$0.00 (free tier)", status: "" },
    ],
  },
  {
    section: "SEARCH",
    items: [
      { label: "Search Provider", value: "Serper.dev", status: "active" },
      { label: "Results per query", value: "5", status: "" },
    ],
  },
  {
    section: "WATCHLIST",
    items: [
      { label: "Default refresh interval", value: "3 days", status: "" },
      { label: "Stale threshold", value: "Refresh interval elapsed", status: "" },
    ],
  },
  {
    section: "DATA",
    items: [
      { label: "Storage", value: "Local JSON (database/store.json)", status: "" },
      { label: "Reports", value: "Local Markdown (reports/)", status: "" },
      { label: "Cloud sync", value: "Not configured — Supabase planned", status: "planned" },
    ],
  },
];

export default function Settings() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>
            Configuration is managed via <code>.env</code> in the project root.
            This page shows current active settings read from your environment.
          </p>

          {SETTINGS.map((group) => (
            <div key={group.section} className={styles.group}>
              <div className={styles.groupLabel}>{group.section}</div>
              {group.items.map((item) => (
                <div key={item.label} className={styles.row}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <span className={styles.rowValue}>{item.value}</span>
                  {item.status && (
                    <span className={`${styles.badge} ${styles[item.status]}`}>
                      {item.status.toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}

          <div className={styles.envNote}>
            <div className={styles.groupLabel}>ENVIRONMENT FILE</div>
            <div className={styles.envBlock}>
              <div className={styles.envLine}><span className={styles.envKey}>SERPER_API_KEY</span>=<span className={styles.envVal}>••••••••••••••••</span></div>
              <div className={styles.envLine}><span className={styles.envKey}>GROQ_API_KEY</span>=<span className={styles.envVal}>••••••••••••••••</span></div>
              <div className={styles.envLine}><span className={styles.envKey}>GROQ_MODEL</span>=<span className={styles.envVal}>llama-3.1-8b-instant</span></div>
              <div className={styles.envLine}><span className={styles.envKey}>OLLAMA_URL</span>=<span className={styles.envVal}>http://localhost:11434</span></div>
              <div className={styles.envLine}><span className={styles.envKey}>OLLAMA_MODEL</span>=<span className={styles.envVal}>llama3.1:8b</span></div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
