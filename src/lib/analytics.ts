/**
 * Task 4.1 — server-side PostHog wrapper for server/agent-server.ts.
 * Graceful no-op if POSTHOG_KEY isn't set, matching the rest of this
 * codebase's pattern for optional third-party integrations (LLM keys,
 * political-research APIs) — missing config degrades a feature, never
 * crashes the request that triggered it.
 */
import { PostHog } from "posthog-node";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.POSTHOG_KEY;
  client = key
    ? new PostHog(key, { host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com" })
    : null;
  return client;
}

export function trackEvent(userId: string, event: string, properties?: Record<string, unknown>) {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({ distinctId: userId, event, properties });
  } catch (err) {
    console.error(`[analytics] failed to capture "${event}":`, err);
  }
}
