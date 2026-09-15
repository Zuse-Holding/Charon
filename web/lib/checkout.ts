export type SellablePlan = "basic" | "pro";

/**
 * Starts a Checkout Session for a plan. If the caller isn't logged in
 * (401), sends them to signup with the plan carried through as a query
 * param — see web/app/login/page.tsx and web/app/checkout-redirect/page.tsx,
 * which pick it back up once auth completes (email/password or Google).
 * Shared by the pricing page and the homepage's own pricing section so
 * both don't reimplement this.
 */
export async function startCheckout(
  plan: SellablePlan,
  router: { push: (url: string) => void }
): Promise<{ error?: string }> {
  try {
    // redirect: "manual" is required here — middleware.ts redirects any
    // unauthenticated /api/* request to /login with a 307, and a normal
    // fetch() silently follows that, handing back a 200 (the login page's
    // HTML) instead of ever exposing the redirect. With "manual", an
    // intercepted request instead comes back as an opaque redirect
    // (status 0, type "opaqueredirect") that we can detect below. The
    // checkout route's own 401 check (no session) is a second line of
    // defense for a request that somehow reaches the handler unauthenticated.
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
      redirect: "manual",
    });

    if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401) {
      router.push(`/login?mode=signup&plan=${plan}`);
      return {};
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      return { error: data.error ?? "Could not start checkout — please try again." };
    }

    window.location.href = data.url;
    return {};
  } catch {
    return { error: "Could not start checkout — please try again." };
  }
}
