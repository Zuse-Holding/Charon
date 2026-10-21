import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getAgentSecret } from "../../../../lib/agent-secret";
import { getStripe } from "../../../../lib/stripe";
import { computeAccountEconomics, computePastDue, computeSaasMetrics, fetchStripeBilling } from "../../../../lib/saas-metrics";

const AGENT_URL = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";

/**
 * Admin unit-economics metrics (Charon tier). The agent server call comes
 * first and doubles as the authorization check — Stripe is never queried
 * for a non-admin. See web/lib/saas-metrics.ts for the formulas.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const res = await fetch(`${AGENT_URL}/admin/unit-economics/${user.id}`, {
      headers: { "x-agent-secret": getAgentSecret() },
      cache: "no-store",
    });
    if (res.status === 403) {
      return NextResponse.json({ error: "Admin metrics requires an admin account" }, { status: 403 });
    }
    if (!res.ok) throw new Error("Agent unit-economics fetch failed");
    const costs = await res.json();

    const now = Date.now();
    const windowStartSec = Math.floor(new Date(costs.windowStart).getTime() / 1000);
    const billing = await fetchStripeBilling(getStripe(), windowStartSec);

    const accounts = costs.accounts ?? [];
    return NextResponse.json({
      metrics: computeSaasMetrics(billing, costs, now, costs.windowDays),
      accountEconomics: computeAccountEconomics(accounts, billing.subscriptions, costs.windowDays).slice(0, 15),
      pastDue: computePastDue(billing.subscriptions, accounts),
      recentSpend: costs.recentSpend,
    });
  } catch (err) {
    console.error("[api/admin/metrics] failed:", err);
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}
