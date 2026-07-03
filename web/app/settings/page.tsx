"use client";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import styles from "./page.module.css";

export default function Settings() {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
  }, []);

  const SYSTEM_INFO = [
    { section: "INTELLIGENCE ENGINE", items: [
      { label: "LLM Provider",    value: "Groq · llama-3.3-70b-versatile", status: "active" },
      { label: "KG Extraction",   value: "OpenRouter · gpt-oss-120b",       status: "active" },
      { label: "Search Provider", value: "Serper.dev",                       status: "active" },
      { label: "Agent Pipeline",  value: "7 parallel agents",                status: "" },
      { label: "Full Page Fetch", value: "Enabled",                          status: "active" },
    ]},
    { section: "DATA", items: [
      { label: "Storage",         value: "Supabase (cloud)",     status: "active" },
      { label: "Auth",            value: "Supabase Auth",        status: "active" },
      { label: "Knowledge Graph", value: "Phase 1 — collecting", status: "active" },
    ]},
    { section: "ACCOUNT", items: [
      { label: "Email", value: email || "Loading...", status: "" },
      { label: "Plan",  value: "Basic",               status: "active" },
    ]},
  ];

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar />
        <div className={styles.content}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>
            System configuration and account information for your Charon workspace.
          </p>

          {SYSTEM_INFO.map((group) => (
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

          <div className={styles.group}>
            <div className={styles.groupLabel}>UPGRADE</div>
            <div className={styles.upgradeCard}>
              <div className={styles.upgradeText}>
                Unlock Deep Dive, Knowledge Graph, and unlimited watchlist tracking with Pro.
              </div>
              <a href="mailto:hello@zuseholdings.com?subject=Charon Pro Upgrade" className={styles.upgradeBtn}>
                Contact us to upgrade →
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}