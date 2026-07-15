import { createServerSupabaseClient } from "./supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

export type InternalTierResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; status: 401 | 404 | 500 };

/**
 * Charon-tier gate for internal-ops routes/pages. Only tier === "internal"
 * passes. Fails closed on any error (unlike /api/tier, a UI-display
 * endpoint that safely falls back to "basic" on failure — this gate must
 * not fail open). Non-internal and unauthenticated users both get treated
 * as "not found" rather than a distinguishable 403, so the route's
 * existence isn't signaled to accounts that shouldn't know about it.
 */
export async function requireInternalTier(): Promise<InternalTierResult> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  try {
    const res = await fetch(`${AGENT_URL}/tier/${user.id}`, {
      headers: { "x-agent-secret": AGENT_SECRET },
      next: { revalidate: 60 },
    });
    if (!res.ok) return { ok: false, status: 500 };

    const data = await res.json();
    if (data.tier !== "internal") return { ok: false, status: 404 };

    return { ok: true, userId: user.id, email: user.email ?? null };
  } catch {
    return { ok: false, status: 500 };
  }
}
