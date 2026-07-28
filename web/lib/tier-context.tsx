"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { createClient } from "../lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tier = "internal" | "team" | "pro" | "basic" | "free" | "trial";

export interface TierConfig {
  dailyResearchLimit: number;   // -1 = unlimited
  dailyDeepDiveLimit: number;
  deepDiveAccess: boolean;
  politicalAccess: boolean;
  watchlistLimit: number;       // -1 = unlimited
  knowledgeGraphAccess: boolean;
  exportAccess: boolean;
  charonProtocol: boolean;
  // Charon-only UI buttons — separate flags so each can be tuned
  // independently later, even though all three are internal-tier-only today.
  personResearchAccess: boolean;
  muckrockAccess: boolean;
  adminAccess: boolean;
  // 7/17 weekend list #1 — hard monthly cap on quick profiles (all research
  // types), scoped to Basic. -1 = unlimited.
  monthlyResearchLimit: number;
  // 7/20 public-record fusion sources (sanctions screening, Wayback
  // archive history, ProPublica nonprofit lookup, LittleSis power-
  // mapping) — Pro/Team+ only, surfaces as a "Public Records" section on
  // company/person reports when true.
  publicRecordsAccess: boolean;
  // Creator / market-signal research (docs/next-verticals-scoping.md
  // item #1) — Charon/internal-only for now, while output quality gets
  // validated on real cases. See the matching comment in
  // server/agent-server.ts's TierConfig.
  creatorAccess: boolean;
  // Photo Identity Verification (1:1 face comparison) — Charon/internal-
  // only, indefinitely (not a "for now" like creatorAccess above). See
  // the matching comment in server/agent-server.ts's TierConfig.
  identityVerificationAccess: boolean;
}

/** Basic-tier monthly quick-profile usage, from the billing-anniversary
 *  window computed server-side. Null when the tier has no monthly cap
 *  (Pro/Team/internal/free). */
export interface MonthlyUsage {
  used: number;
  limit: number;
  resetsAt: string;
}

/** profiles.notification_preferences — persisted now even though no
 *  notification-sending code reads it yet (see Settings #67). */
export interface NotificationPreferences {
  watchlistRefresh: boolean;
  weeklyDigest: boolean;
  productUpdates: boolean;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  watchlistRefresh: true,
  weeklyDigest: false,
  productUpdates: true,
};

interface TierContextValue {
  tier: Tier | null;
  config: TierConfig | null;
  loading: boolean;
  isInternal: boolean;
  displayName: string | null;
  email: string | null;
  monthlyUsage: MonthlyUsage | null;
  notificationPreferences: NotificationPreferences;
  can: (feature: keyof TierConfig) => boolean;
  refresh: () => void;
  /** Sets the user's preferred display name (profiles.display_name).
   *  Pass "" to clear it and fall back to the email-derived name.
   *  Returns whether the save succeeded, and the server's error message
   *  (if any) so callers can actually show what went wrong instead of a
   *  silent no-op. */
  updateDisplayName: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** Merges the given fields into profiles.notification_preferences and
   *  saves the full result. Returns whether the save succeeded. */
  updateNotificationPreferences: (partial: Partial<NotificationPreferences>) => Promise<{ ok: boolean; error?: string }>;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TierConfig = {
  dailyResearchLimit: 3,
  dailyDeepDiveLimit: 0,
  deepDiveAccess: false,
  politicalAccess: false,
  watchlistLimit: 2,
  knowledgeGraphAccess: false,
  exportAccess: false,
  charonProtocol: false,
  personResearchAccess: false,
  muckrockAccess: false,
  adminAccess: false,
  monthlyResearchLimit: -1,
  publicRecordsAccess: false,
  creatorAccess: false,
  identityVerificationAccess: false,
};

const TierContext = createContext<TierContextValue>({
  tier: null,
  config: null,
  loading: true,
  isInternal: false,
  displayName: null,
  email: null,
  monthlyUsage: null,
  notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
  can: () => false,
  refresh: () => {},
  updateDisplayName: async () => ({ ok: false }),
  updateNotificationPreferences: async () => ({ ok: false }),
});

/** Best-effort human-friendly name: metadata full name -> email local part. */
function deriveDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const metaName = (meta.full_name ?? meta.name ?? meta.display_name) as string | undefined;
  if (metaName && metaName.trim()) return metaName.trim();
  if (user.email) {
    const local = user.email.split("@")[0];
    // "nick.olmos" / "nick_olmos" -> "Nick Olmos"
    return local
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function TierProvider({ children }: { children: ReactNode }) {
  const [tier, setTier] = useState<Tier | null>(null);
  const [config, setConfig] = useState<TierConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [emailDerivedName, setEmailDerivedName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [monthlyUsage, setMonthlyUsage] = useState<MonthlyUsage | null>(null);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);

  useEffect(() => {
    let cancelled = false;

    async function fetchTier() {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        const fallbackName = deriveDisplayName(user);
        if (!cancelled) {
          setEmailDerivedName(fallbackName);
          setDisplayName(fallbackName);
          setEmail(user.email ?? null);
        }

        const res = await fetch(`/api/tier`, { credentials: "include" });
        if (!res.ok) throw new Error("tier fetch failed");

        const data = await res.json();
        if (!cancelled) {
          setTier(data.tier);
          setConfig(data.config);
          setMonthlyUsage(data.monthlyUsage ?? null);
          // Prefer the user's own saved preference over the email guess.
          if (data.displayName) setDisplayName(data.displayName);
          setNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...(data.notificationPreferences ?? {}) });
        }
      } catch {
        if (!cancelled) {
          setTier("basic");
          setConfig(DEFAULT_CONFIG);
          setMonthlyUsage(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTier();
    return () => { cancelled = true; };
  }, [tick]);

  const refresh = () => setTick(t => t + 1);

  const updateDisplayName = async (name: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayName: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `Save failed (HTTP ${res.status}).` };
      // Server returns null when the name was cleared — fall back to the
      // email-derived guess so the UI never shows a blank name.
      setDisplayName(data.displayName || emailDerivedName);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error." };
    }
  };

  const updateNotificationPreferences = async (
    partial: Partial<NotificationPreferences>
  ): Promise<{ ok: boolean; error?: string }> => {
    const merged = { ...notificationPreferences, ...partial };
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notificationPreferences: merged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `Save failed (HTTP ${res.status}).` };
      setNotificationPreferences(merged);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error." };
    }
  };

  // ── Auto-logout after inactivity ─────────────────────────────────────
  // Security requirement: sign the user out after 20 minutes with no
  // mouse/keyboard/scroll/touch activity. Gated on `tier` being set — that
  // only happens once a real session is confirmed, so this never fires on
  // public pages (login, landing) where there's no session to time out.
  // Full navigation (window.location) rather than router.push, matching
  // the same "don't rely solely on JS routing" reasoning behind the
  // sign-out link fix — guarantees the redirect fires even if client
  // routing is in a bad state.
  useEffect(() => {
    if (!tier) return;

    const INACTIVITY_LIMIT_MS = 20 * 60 * 1000;
    let lastActivity = Date.now();
    const markActive = () => { lastActivity = Date.now(); };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
        window.location.href = "/logout";
      }
    }, 30_000);

    return () => {
      events.forEach(evt => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
  }, [tier]);

  const isInternal = tier === "internal";

  // can() lets components gate on a single feature flag cleanly
  const can = (feature: keyof TierConfig): boolean => {
    if (!config) return false;
    const val = config[feature];
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    return false;
  };

  return (
    <TierContext.Provider value={{ tier, config, loading, isInternal, displayName, email, monthlyUsage, notificationPreferences, can, refresh, updateDisplayName, updateNotificationPreferences }}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier() {
  return useContext(TierContext);
}
