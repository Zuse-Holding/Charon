"use client";
import { useState } from "react";
import styles from "./KGQueryPanel.module.css";

interface QueryResult {
  found: boolean;
  message?: string;
  hops?: number;
  description?: string;
  path?: { id: string; name: string; type: string; viaRelationship?: string }[];
}

interface Props {
  onPathFound?: (entityIds: string[]) => void;
}

export default function KGQueryPanel({ onPathFound }: Props) {
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<QueryResult | null>(null);
  const [open, setOpen]           = useState(false);

  async function runQuery() {
    if (!fromQuery.trim() || !toQuery.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/knowledge-graph/query?from=${encodeURIComponent(fromQuery.trim())}&to=${encodeURIComponent(toQuery.trim())}`
      );
      const data: QueryResult = await res.json();
      setResult(data);
      if (data.found && data.path) {
        onPathFound?.(data.path.map(p => p.id));
      }
    } catch {
      setResult({ found: false, message: "Query failed — please try again." });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className={styles.openBtn} onClick={() => setOpen(true)}>
        ⬡ Find connection between two entities →
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Cross-Entity Query</span>
        <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder="First entity (e.g. Tesla)"
          value={fromQuery}
          onChange={e => setFromQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runQuery()}
        />
        <span className={styles.connector}>↔</span>
        <input
          className={styles.input}
          placeholder="Second entity (e.g. Rivian)"
          value={toQuery}
          onChange={e => setToQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runQuery()}
        />
        <button className={styles.searchBtn} onClick={runQuery} disabled={loading}>
          {loading ? "..." : "Find"}
        </button>
      </div>

      {result && (
        <div className={`${styles.resultBox} ${result.found ? styles.resultFound : styles.resultEmpty}`}>
          {result.found ? (
            <>
              <div className={styles.resultHops}>
                {result.hops === 1 ? "Direct connection" : `Connected via ${result.hops} hops`}
              </div>
              <div className={styles.resultPath}>{result.description}</div>
            </>
          ) : (
            <div className={styles.resultMessage}>{result.message}</div>
          )}
        </div>
      )}
    </div>
  );
}
