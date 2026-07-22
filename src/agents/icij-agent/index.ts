import { OffshoreLeakMatch, Source } from "../../types/research.js";

/**
 * ICIJ Offshore Leaks Agent (7/20 public-record fusion) — Charon-tier
 * only, gated at the call site (orchestrator's `deep` flag / person-
 * research/deep route), same pattern as OpenCorporates and MuckRock.
 * Not gated inside this agent itself.
 *
 * Uses ICIJ's public Reconciliation API (offshoreleaks.icij.org), which
 * matches a query name against entities, officers, intermediaries, and
 * addresses across the Panama/Paradise/Pandora/Bahamas/Offshore Leaks
 * datasets. No key required, but this is explicitly a beta API and a
 * fuzzy-match service, not a lookup by confirmed identity — result
 * scores reflect string-similarity confidence, not "this is definitely
 * the same person." Always framed as "possible offshore-leaks match" in
 * the report, never as a confirmed finding, same posture as
 * sanctions-agent.
 */

const ICIJ_RECONCILE_URL = "https://offshoreleaks.icij.org/api/v1/reconcile";

interface ReconcileCandidate {
  id?: string;
  name?: string;
  score?: number;
  type?: { id?: string; name?: string }[];
}

interface ReconcileResponse {
  result?: ReconcileCandidate[];
}

export class IcijAgent {
  async run(name: string): Promise<{ matches: OffshoreLeakMatch[]; sources: Source[] }> {
    try {
      const res = await fetch(ICIJ_RECONCILE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: name }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[icij-agent] "${name}" — HTTP ${res.status}`);
        return { matches: [], sources: [] };
      }

      const data = (await res.json()) as ReconcileResponse;
      const results = data.result ?? [];

      const matches: OffshoreLeakMatch[] = results
        .filter((r): r is ReconcileCandidate & { id: string; name: string } => Boolean(r.id && r.name))
        .slice(0, 8)
        .map((r) => ({
          name: r.name,
          entityType: r.type?.[0]?.name,
          score: r.score,
          url: `https://offshoreleaks.icij.org/nodes/${r.id}`,
        }));

      const sources: Source[] = matches.length > 0
        ? [{
            url: `https://offshoreleaks.icij.org/search?q=${encodeURIComponent(name)}`,
            title: `ICIJ Offshore Leaks Database — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["offshore-leaks"],
          }]
        : [];

      console.log(`[icij-agent] "${name}" — ${matches.length} possible match(es)`);

      return { matches, sources };
    } catch (err) {
      console.warn(`[icij-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { matches: [], sources: [] };
    }
  }
}
