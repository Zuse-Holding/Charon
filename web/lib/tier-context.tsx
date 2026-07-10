"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { createClient } from "../lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tier = "internal" | "team" | "pro" | "basic" | "free";

export interface TierConfig {
  dailyResearchLimit: number;   // -1 = unlimited
  dailyDeepDiveLimit: number;
  deepDiveAccess: boolean;
  politicalAccess: boolean;
  watchlistLimit: number;       // -1 = unlimited
  knowledgeGraphAccess: boolean;
  exportAccess: boolean;
  jackalProtocol: boolean;
}

interface TierContextValue {
  tier: Tier | null;
  config: TierConfig | null;
  loading: boolean;
  isInternal: boolean;
  displayName: string | null;
  email: string | null;
  can: (feature: keyof TierConfig) => boolean;
  refresh: () => void;
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
  jackalProtocol: false,
};

const TierContext = createContext<TierContextValue>({
  tier: null,
  config: null,
  loading: true,
  isInternal: false,
  displayName: null,
  email: null,
  can: () => false,
  refresh: () => {},
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
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTier() {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        if (!cancelled) {
          setDisplayName(deriveDisplayName(user));
          setEmail(user.email ?? null);
        }

        const res = await fetch(`/api/tier`, { credentials: "include" });
        if (!res.ok) throw new Error("tier fetch failed");

        const data = await res.json();
        if (!cancelled) {
          setTier(data.tier);
          setConfig(data.config);
        }
      } catch {
        if (!cancelled) {
          setTier("basic");
          setConfig(DEFAULT_CONFIG);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTier();
    return () => { cancelled = true; };
  }, [tick]);

  const refresh = () => setTick(t => t + 1);

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
    <TierContext.Provider value={{ tier, config, loading, isInternal, displayName, email, can, refresh }}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier() {
  return useContext(TierContext);
}
