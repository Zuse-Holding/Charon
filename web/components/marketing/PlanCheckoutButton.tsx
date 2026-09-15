"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { startCheckout, type SellablePlan } from "../../lib/checkout";
import styles from "./PlanCheckoutButton.module.css";

/**
 * Drop-in replacement for a plain <Link> plan CTA — same visual className,
 * but actually starts a Stripe Checkout Session (or sends a logged-out
 * visitor to signup first, plan carried through). See web/lib/checkout.ts.
 */
export function PlanCheckoutButton({
  plan,
  label,
  className,
}: {
  plan: SellablePlan;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    const result = await startCheckout(plan, router);
    setLoading(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={className} onClick={handleClick} disabled={loading}>
        {loading ? "..." : label}
      </button>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
