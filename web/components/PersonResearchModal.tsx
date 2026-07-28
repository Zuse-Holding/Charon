"use client";
import { useState } from "react";
import styles from "./CharonToolModal.module.css";

interface Source {
  url: string;
  title?: string;
}

interface CorporateAffiliation {
  companyName: string;
  position?: string;
  jurisdiction?: string;
  startDate?: string;
  endDate?: string;
  companyUrl?: string;
}

interface FecDonorBreakdownEntry {
  employer: string;
  total: string;
}

interface FecSummary {
  name: string;
  party?: string;
  cycle?: string;
  totalReceipts?: string;
  cashOnHand?: string;
}

interface CourtListenerRecord {
  caseName: string;
  url: string;
  court?: string;
  dateFiled?: string;
  docketNumber?: string;
}

interface HandleResolutionCandidate {
  name: string;
  confidence: "high" | "medium" | "low";
  platforms: string[];
  profileUrls: string[];
  evidence: string;
  sourceUrls: string[];
}

interface PersonResearchResult {
  name: string;
  generatedAt: string;
  openCorporates: { affiliations: CorporateAffiliation[]; sources: Source[] };
  fec: { summary?: FecSummary; donorBreakdown: FecDonorBreakdownEntry[]; sources: Source[] };
  courtListener: { records: CourtListenerRecord[]; sources: Source[] };
  handleResolution: { candidates: HandleResolutionCandidate[]; sources: Source[] };
  form4: { available: false; reason: string };
  pacer: { available: false; reason: string };
}

interface Props {
  onClose: () => void;
}

export default function PersonResearchModal({ onClose }: Props) {
  const [name, setName]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<PersonResearchResult | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/person-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Person Research — Charon</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <p className={styles.subtitle}>
          Cross-references corporate directorships, federal campaign finance, federal court records, and handle/username resolution for a name.
        </p>

        <form className={styles.form} onSubmit={runSearch}>
          <input
            className={styles.input}
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button className={styles.submitBtn} type="submit" disabled={loading || !name.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <div className={styles.error}>{error}</div>}
        {loading && <div className={styles.loading}>Querying OpenCorporates, FEC, CourtListener, and handle resolution…</div>}

        {result && (
          <>
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>OpenCorporates — Directorships</span>
                <span className={`${styles.sectionStatus} ${styles.live}`}>live</span>
              </div>
              {result.openCorporates.affiliations.length === 0 && (
                <div className={styles.empty}>No corporate officer/director records found.</div>
              )}
              {result.openCorporates.affiliations.map((a, i) => (
                <div key={i} className={styles.entry}>
                  {a.companyUrl
                    ? <a href={a.companyUrl} target="_blank" rel="noopener noreferrer" className={styles.entryLink}>{a.companyName}</a>
                    : a.companyName}
                  <div className={styles.entryMeta}>
                    {[a.position, a.jurisdiction, a.startDate && `since ${a.startDate}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>FEC — Campaign Finance Cross-Reference</span>
                <span className={`${styles.sectionStatus} ${styles.live}`}>live</span>
              </div>
              {!result.fec.summary && (
                <div className={styles.empty}>No FEC candidate match (state/local candidates aren&apos;t in FEC data).</div>
              )}
              {result.fec.summary && (
                <div className={styles.entry}>
                  {result.fec.summary.name}
                  <div className={styles.entryMeta}>
                    {[result.fec.summary.party, result.fec.summary.cycle && `${result.fec.summary.cycle} cycle`, result.fec.summary.totalReceipts && `$${result.fec.summary.totalReceipts} raised`].filter(Boolean).join(" · ")}
                  </div>
                </div>
              )}
              {result.fec.donorBreakdown.slice(0, 5).map((d, i) => (
                <div key={i} className={styles.entryMeta}>{d.employer} — ${d.total}</div>
              ))}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>CourtListener — Federal Court Records</span>
                <span className={`${styles.sectionStatus} ${styles.live}`}>live</span>
              </div>
              {result.courtListener.records.length === 0 && (
                <div className={styles.empty}>No matching RECAP/federal docket records found.</div>
              )}
              {result.courtListener.records.map((r, i) => (
                <div key={i} className={styles.entry}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className={styles.entryLink}>{r.caseName}</a>
                  <div className={styles.entryMeta}>
                    {[r.court, r.docketNumber, r.dateFiled].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Handle Resolution — Name Candidates</span>
                <span className={`${styles.sectionStatus} ${styles.live}`}>live</span>
              </div>
              {result.handleResolution.candidates.length === 0 && (
                <div className={styles.empty}>No name candidates resolved from a handle for this query.</div>
              )}
              {result.handleResolution.candidates.map((c, i) => (
                <div key={i} className={styles.entry}>
                  {c.name}
                  <span className={`${styles.confidence} ${styles[c.confidence]}`}>{c.confidence}</span>
                  <div className={styles.entryMeta}>{c.evidence}</div>
                  <div className={styles.entryMeta}>
                    {c.sourceUrls.map((url, j) => (
                      <span key={url}>
                        {j > 0 && " · "}
                        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.entryLink}>
                          {new URL(url).hostname.replace(/^www\./, "")}
                        </a>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className={`${styles.section} ${styles.disabled}`}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Form 4 — Insider Trading</span>
                <span className={`${styles.sectionStatus} ${styles.unavailable}`}>not available</span>
              </div>
              <div className={styles.reason}>{result.form4.reason}</div>
            </div>

            <div className={`${styles.section} ${styles.disabled}`}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>PACER — Federal Litigation</span>
                <span className={`${styles.sectionStatus} ${styles.unavailable}`}>not available</span>
              </div>
              <div className={styles.reason}>{result.pacer.reason}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
