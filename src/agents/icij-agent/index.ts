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
 *
 * MIN_RELEVANCE_SCORE is empirically set, not guessed — checked live
 * against real queries before picking 70:
 *   - Genuine exact-name hits score 100 flat (e.g. "Simon Cowell", "Emma
 *     Watson", "Petro Poroshenko" — real people confirmed in these
 *     leaks, queried under their exact name, both scored 100).
 *   - The noisiest false-positive seen across several test queries
 *     (Charles Koch, George Soros, Vladimir Putin) topped out at 73.3
 *     ("KOLTON, VLADIMIR" for a "Vladimir Putin" query) — everything
 *     else, including every single result for "Charles Koch" and
 *     "George Soros" (German street addresses containing "Koch", "Charles
 *     Hiten", "Schwartz, George"), scored under 62.
 * 70 sits in the gap: comfortably above the observed noise ceiling,
 * comfortably below every confirmed real match. Neither Koch nor Soros
 * has an actual offshore-leaks record under that name — the correct
 * result for both is zero matches, not "here are some German street
 * addresses that happen to contain a Koch."
 */

const ICIJ_RECONCILE_URL = "https://offshoreleaks.icij.org/api/v1/reconcile";
const MIN_RELEVANCE_SCORE = 70;

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
        // Below MIN_RELEVANCE_SCORE is noise, not a possible match — see
        // the class doc comment for the empirical basis. Anything below
        // this floor gets discarded here, never surfaced to a report.
        .filter((r) => (r.score ?? 0) >= MIN_RELEVANCE_SCORE)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 8)
        .map((r) => ({
          name: r.name,
          entityType: r.type?.[0]?.name,
          score: r.score,
          url: `https://offshoreleaks.icij.org/nodes/${r.id}`,
        }));

      // A source, not just its matches, so the caller (and report) can
      // always tell "ICIJ ran and found nothing above the relevance
      // floor" apart from "ICIJ never ran" — see orchestrator's `deep`-
      // gated offshoreLeaksMatches assignment and report-agent's explicit
      // empty state.
      const sources: Source[] = [{
        url: `https://offshoreleaks.icij.org/search?q=${encodeURIComponent(name)}`,
        title: `ICIJ Offshore Leaks Database — ${name}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["offshore-leaks"],
      }];

      console.log(`[icij-agent] "${name}" — ${matches.length} match(es) above the relevance floor (of ${results.length} raw candidate(s))`);

      return { matches, sources };
    } catch (err) {
      console.warn(`[icij-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { matches: [], sources: [] };
    }
  }
}
