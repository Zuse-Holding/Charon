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

// Must match the connect-src entry in next.config.ts.
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

function ensureInit(): boolean {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  if (!initialized) {
    posthog.init(key, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      // This wrapper exists for one explicit event (pdf_export), so turn off
      // everything posthog-js does on its own: no cookies or localStorage
      // (the privacy policy promises essential cookies only), no automatic
      // clicks/pageviews, no recordings or surveys, and no scripts loaded
      // from PostHog's CDN (the CSP in next.config.ts allows only the API host).
      persistence: "memory",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
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
