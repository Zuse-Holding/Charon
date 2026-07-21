"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Getting-started checklist for the dashboard. Every step is derived from
// real account state (research runs, watchlist, display name, and a
// "visited the Knowledge Graph page" flag set by that page on mount) —
// nothing here is faked just to look complete. Dismissal is sticky via
// localStorage so it doesn't come back once someone's closed it, even if
// they never finish every step.
const DISMISSED_KEY  = "metis_onboarding_dismissed";
const VISITED_KG_KEY = "metis_visited_kg";

interface Props {
  hasResearch: boolean;
  hasWatchlistItem: boolean;
  hasDisplayName: boolean;
}

interface Step {
  label: string;
  done: boolean;
  actionLabel: string;
  href: string;
}

const ACCENT = "#8B5CF6";

export default function OnboardingChecklist({ hasResearch, hasWatchlistItem, hasDisplayName }: Props) {
  const router = useRouter();
  // Default to "hidden" until localStorage has been checked client-side,
  // so a user who already dismissed this doesn't see a flash of it on
  // every page load.
  const [dismissed, setDismissed] = useState(true);
  const [visitedKG, setVisitedKG] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    setVisitedKG(localStorage.getItem(VISITED_KG_KEY) === "1");
    setChecked(true);
  }, []);

  if (!checked || dismissed) return null;

  const steps: Step[] = [
    { label: "Run your first research",         done: hasResearch,      actionLabel: "Research →",  href: "/app" },
    { label: "Add a company to your watchlist",  done: hasWatchlistItem, actionLabel: "Watchlist →", href: "/app" },
    { label: "Set your display name",            done: hasDisplayName,   actionLabel: "Settings →",  href: "/settings" },
    { label: "Explore the Knowledge Graph",       done: visitedKG,        actionLabel: "Explore →",   href: "/knowledge-graph" },
  ];
  const doneCount = steps.filter(s => s.done).length;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <div style={{
      background: "#111827", border: "1px solid #1C2333", borderTop: `2px solid ${ACCENT}`,
      borderRadius: 10, padding: "16px 18px",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#6B7A99",
        textTransform: "uppercase", marginBottom: 14,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span>Getting Started</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 10, background: `${ACCENT}22`, color: ACCENT,
            border: `1px solid ${ACCENT}44`, borderRadius: 4, padding: "1px 6px", fontWeight: 700,
          }}>{doneCount}/{steps.length}</span>
          <button
            onClick={dismiss}
            aria-label="Dismiss getting-started checklist"
            style={{
              background: "none", border: "none", color: "#6B7A99", cursor: "pointer",
              fontSize: 13, lineHeight: 1, padding: 0,
            }}
          >✕</button>
        </div>
      </div>

      {doneCount === steps.length ? (
        <div style={{ fontSize: 12, color: "#EDF2F7", lineHeight: 1.5 }}>
          ✓ You&apos;re all set up — nice work.
        </div>
      ) : (
        steps.map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: i === steps.length - 1 ? 0 : 10,
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700,
              border: `1px solid ${s.done ? ACCENT : "#2A3348"}`,
              background: s.done ? ACCENT : "transparent",
              color: s.done ? "#0B0F1A" : "transparent",
            }}>✓</span>
            <span style={{
              flex: 1, fontSize: 12,
              color: s.done ? "#6B7A99" : "#EDF2F7",
              textDecoration: s.done ? "line-through" : "none",
            }}>
              {s.label}
            </span>
            {!s.done && (
              <button
                onClick={() => router.push(s.href)}
                style={{
                  background: "none", border: `1px solid ${ACCENT}44`, color: ACCENT,
                  borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >{s.actionLabel}</button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
