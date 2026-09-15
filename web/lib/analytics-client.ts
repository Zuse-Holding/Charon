"use client";

/**
 * Task 4.1 — browser-side PostHog wrapper, used only where there's no
 * server-side hook to fire an event from (currently just pdf_export:
 * window.print() runs entirely client-side, in app/page.tsx and
 * app/print/[id]/page.tsx). Everything else goes through web/lib/analytics.ts
 * or src/lib/analytics.ts instead — server-side capture is preferred
 * whenever a request already touches the server, so this stays the
 * exception, not the default. Graceful no-op if NEXT_PUBLIC_POSTHOG_KEY
 * isn't set.
 */
import posthog from "posthog-js";

let initialized = false;

function ensureInit(): boolean {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  if (!initialized) {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      person_profiles: "identified_only",
    });
    initialized = true;
  }
  return true;
}

export function trackClientEvent(event: string, properties?: Record<string, unknown>) {
  try {
    if (!ensureInit()) return;
    posthog.capture(event, properties);
  } catch (err) {
    console.error(`[analytics] failed to capture "${event}":`, err);
  }
}
