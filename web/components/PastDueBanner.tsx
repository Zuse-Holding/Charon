"use client";
import { useTier } from "../lib/tier-context";
import styles from "./PastDueBanner.module.css";

/**
 * Sits in the root layout (renders on every page) so it shows regardless
 * of which authenticated route the user is on. Renders nothing for logged-
 * out visitors (tier is null on marketing pages) or anyone not in
 * "past_due" — access itself isn't restricted at this status (see the
 * webhook's handling of customer.subscription.updated), this is purely a
 * heads-up while Stripe's Smart Retries work through the failed charge.
 */
export function PastDueBanner() {
  const { subscriptionStatus } = useTier();

  if (subscriptionStatus !== "past_due") return null;

  return (
    <div className={styles.banner} role="alert">
      Your last payment didn&apos;t go through. We&apos;ll keep retrying automatically —
      update your card in{" "}
      <a href="/settings" className={styles.link}>Settings → Billing</a> to avoid
      losing access.
    </div>
  );
}
