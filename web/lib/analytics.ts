/**
 * Task 4.1 — server-side PostHog wrapper for Next.js API routes. Mirrors
 * src/lib/analytics.ts (the agent-server equivalent); kept as a separate
 * copy rather than a shared import because web/ and the root project are
 * two independent npm packages with their own dependency trees.
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
