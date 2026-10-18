"use client";
import { useEffect, useState } from "react";
import { useTier } from "../lib/tier-context";
import { upgradeTarget, usageRows } from "../lib/usage";
import styles from "./UsageLimitBanner.module.css";

const DISMISS_KEY = "metis.usageBanner.dismissed";

/**
 * Sits in the root layout next to PastDueBanner. Shows once any cap
 * (monthly or the 8-hour work window) hits 80%, and again (un-dismissed) when it's actually reached —
 * the dismiss key includes the status, so hiding the "near" warning
 * doesn't also hide the "reached" one. Renders on mobile too, where the
 * sidebar's usage meter is hidden.
 */
export function UsageLimitBanner() {
  const { tier, monthlyUsage, monthlyDeepDiveUsage, windowUsage } = useTier();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try { setDismissed(sessionStorage.getItem(DISMISS_KEY)); } catch { /* storage blocked */ }
  }, []);

  const flagged = usageRows({ monthlyUsage, monthlyDeepDiveUsage, windowUsage }).filter(r => r.status !== "ok");
  if (!tier || flagged.length === 0) return null;

  // Lead with the worst one: a reached cap beats a near one.
  const row = flagged.find(r => r.status === "danger") ?? flagged[0];
  const key = `${row.key}:${row.status}:${row.resets}`;
  if (dismissed === key) return null;

  const upgrade = upgradeTarget(tier);
  const thing = row.label.toLowerCase();
  const resets = row.resets ? ` They reset ${row.periodTag === "month" ? "" : "at "}${row.resets}.` : "";
  const message = row.status === "danger"
    ? `You've used all ${row.limit} ${thing} ${row.periodPhrase}.${resets}`
    : `You've used ${row.used} of ${row.limit} ${thing} ${row.periodPhrase}.${resets}`;

  function dismiss() {
    setDismissed(key);
    try { sessionStorage.setItem(DISMISS_KEY, key); } catch { /* storage blocked */ }
  }

  return (
    <div className={`${styles.banner} ${row.status === "danger" ? styles.danger : ""}`} role="status">
      <span>{message}</span>
      {upgrade && (
        <a href={upgrade.href} className={styles.link}>{upgrade.label}</a>
      )}
      <button className={styles.close} onClick={dismiss} aria-label="Hide this warning">×</button>
    </div>
  );
}
