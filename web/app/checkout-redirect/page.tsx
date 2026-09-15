"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startCheckout, type SellablePlan } from "../../lib/checkout";

/**
 * Landing spot for "sign up for Pro" style flows: the login page sends
 * both the email/password path and the Google OAuth redirect (via its
 * `next` param) here with `?plan=`, once a session actually exists. This
 * page's only job is firing the Checkout Session immediately and handing
 * off to Stripe — see web/lib/checkout.ts.
 */
function CheckoutRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const plan = params.get("plan");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (plan !== "basic" && plan !== "pro") {
      router.push("/pricing");
      return;
    }
    startCheckout(plan as SellablePlan, router).then((result) => {
      if (result.error) setError(result.error);
    });
    // Intentionally run once — startCheckout redirects the page away on
    // success, so there's nothing to react to afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", flexDirection: "column", gap: 12 }}>
      {error ? (
        <>
          <p>{error}</p>
          <a href="/pricing">Back to pricing →</a>
        </>
      ) : (
        <p>Taking you to checkout...</p>
      )}
    </div>
  );
}

export default function CheckoutRedirectPage() {
  return (
    <Suspense>
      <CheckoutRedirect />
    </Suspense>
  );
}
