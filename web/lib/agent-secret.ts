/**
 * Shared secret between Vercel and the agent server (Railway/VPS) — the
 * only thing gating server/agent-server.ts's routes (see authCheck there).
 * Every one of these routes used to fall back to the literal string
 * "change-me-in-production" when AGENT_SECRET was unset — that fallback
 * is committed in this repo, which is public, so an unconfigured deploy
 * meant anyone could call the agent server directly (see AUDIT.md's
 * top-flagged finding). Throws at call time (not import time, so it
 * doesn't break routes that don't need it) instead of silently using the
 * public default.
 */
export function getAgentSecret(): string {
  const secret = process.env.AGENT_SECRET;
  if (!secret) {
    throw new Error(
      "AGENT_SECRET is not set — refusing to call the agent server without a real shared secret."
    );
  }
  return secret;
}
