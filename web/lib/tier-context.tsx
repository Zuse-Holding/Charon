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
  can: () => false,
  refresh: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function TierProvider({ children }: { children: ReactNode }) {
  const [tier, setTier] = useState<Tier | null>(null);
  const [config, setConfig] = useState<TierConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchTier() {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

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
    <TierContext.Provider value={{ tier, config, loading, isInternal, can, refresh }}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier() {
  return useContext(TierContext);
}
