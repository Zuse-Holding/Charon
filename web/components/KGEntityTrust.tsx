"use client";
import { useEffect, useState } from "react";
import styles from "./KGEntityTrust.module.css";

/**
 * Entity resolution (Feature 3) in the Knowledge Graph.
 *
 *   KGMatchReview    possible matches waiting for a decision: merge or keep
 *                    separate. A name alone never merges two entities.
 *   KGEntityTrust    in the node panel: the entity's identifiers with their
 *                    sources, and how it relates to same-named entities.
 */

interface Review {
  id: string;
  entity_id: string | null;
  entity_name: string;
  candidate_id: string | null;
  candidate_name: string;
  status?: "pending" | "distinct" | "rejected";
  reason: "name_only" | "conflicting_identifiers";
}

interface IdentifierRow {
  kind: string;
  issuer: string;
  value: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
}

const KIND_LABEL: Record<string, string> = {
  state_entity_number: "Entity number",
  ein: "EIN",
  ucc_filing: "UCC filing",
  license: "License",
  court_party_id: "Court party ID",
};

/** "us_de" -> "DE", "gb" -> "GB" */
function issuerLabel(issuer: string): string {
  return issuer.replace(/^us_/, "").toUpperCase();
}

async function decide(id: string, decision: "confirmed" | "rejected"): Promise<string | null> {
  const res = await fetch(`/api/knowledge-graph/matches/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? "That didn't go through. Try again.";
}

function MatchActions({ review, onDone }: { review: Review; onDone: (merged: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(decision: "confirmed" | "rejected") {
    setBusy(true);
    setError(null);
    const err = await decide(review.id, decision);
    setBusy(false);
    if (err) setError(err);
    else onDone(decision === "confirmed");
  }
  return (
    <>
      <div className={styles.actions}>
        <button type="button" className={styles.merge} disabled={busy} onClick={() => run("confirmed")}>Merge them</button>
        <button type="button" className={styles.keep} disabled={busy} onClick={() => run("rejected")}>Keep separate</button>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </>
  );
}

export function KGMatchReview() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/knowledge-graph/matches")
      .then((r) => (r.ok ? r.json() : []))
      .then(setReviews)
      .catch(() => {});
  }, []);

  if (reviews.length === 0) return null;
  return (
    <div className={styles.review}>
      <button type="button" className={styles.reviewToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        ? {reviews.length} possible match{reviews.length === 1 ? "" : "es"} to review
      </button>
      {open && (
        <div className={styles.reviewList}>
          <p className={styles.note}>
            These share a name but no ID number, so they&apos;re kept apart until you say they&apos;re the same.
          </p>
          {reviews.map((r) => (
            <div key={r.id} className={styles.reviewItem}>
              <div className={styles.pair}>{r.entity_name} <span className={styles.muted}>and</span> {r.candidate_name}</div>
              <MatchActions
                review={r}
                onDone={(merged) => {
                  // A merge removes a node and moves its edges: reload the graph.
                  if (merged) window.location.reload();
                  else setReviews((prev) => prev.filter((x) => x.id !== r.id));
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KGEntityTrust({ entityId }: { entityId: string }) {
  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    let live = true;
    setIdentifiers([]);
    setReviews([]);
    fetch(`/api/knowledge-graph/entities/${entityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setIdentifiers(d.identifiers ?? []);
        setReviews(d.reviews ?? []);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [entityId]);

  const otherName = (r: Review) => (r.entity_id === entityId ? r.candidate_name : r.entity_name);
  const pending = reviews.filter((r) => r.status === "pending");
  const distinct = reviews.filter((r) => r.status === "distinct" || r.status === "rejected");

  return (
    <div className={styles.trust}>
      {identifiers.length === 0 ? (
        <div className={styles.muted}>No ID number on record. Matched by name only.</div>
      ) : (
        identifiers.map((i) => (
          <div key={`${i.kind}${i.issuer}${i.value}`} className={styles.idRow}>
            <span className={styles.idKind}>{KIND_LABEL[i.kind] ?? i.kind}{i.issuer ? ` · ${issuerLabel(i.issuer)}` : ""}</span>
            <span className={styles.idValue}>{i.value}</span>
            <a href={i.source_url} target="_blank" rel="noopener noreferrer" className={styles.idSource}>{i.source_name} ↗</a>
          </div>
        ))
      )}
      {pending.map((r) => (
        <div key={r.id} className={styles.flag}>
          <div>? Possible match: {otherName(r)}</div>
          <MatchActions
            review={r}
            onDone={(merged) => {
              if (merged) window.location.reload();
              else setReviews((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "rejected" } : x)));
            }}
          />
        </div>
      ))}
      {distinct.map((r) => (
        <div key={r.id} className={styles.distinct}>
          ≠ Distinct from {otherName(r)}
          {r.reason === "conflicting_identifiers" ? " (different ID numbers)" : " (you kept them separate)"}
        </div>
      ))}
    </div>
  );
}
