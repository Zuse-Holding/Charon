import { SanctionsMatch, Source } from "../../types/research.js";

/**
 * Sanctions Agent (7/20 public-record fusion, roadmap #1) — screens a
 * name against the Consolidated Screening List (api.trade.gov), which
 * merges eleven US export-control/sanctions lists from Commerce, State,
 * and Treasury into one feed — including OFAC's SDN list, the actual
 * target of this roadmap item, plus the Entity List, Denied Persons
 * List, and others. Chose this over OFAC's own Sanctions List Service
 * because that one is a raw XML/CSV file drop with no search endpoint —
 * fuzzy name matching, indexing, and staying current would all be on us.
 * The CSL API does that server-side and covers strictly more ground.
 *
 * Requires TRADE_GOV_API_KEY (free, instant signup at developer.trade.gov —
 * register + subscribe to "Consolidated Screening List API"). Missing key
 * fails open to no results, same as every other keyed agent here.
 *
 * A match here is not an accusation — sanctions lists include historical/
 * delisted entries and name collisions happen constantly (common names,
 * transliteration variants). Always surfaced as "possible sanctions list
 * match," never asserted as fact — same posture as icij-agent.
 */

const CSL_BASE = "https://api.trade.gov/consolidated_screening_list/search";

interface CslResult {
  name?: string;
  source?: string;
  type?: string;
  programs?: string[];
  remarks?: string;
  id?: string;
}

interface CslResponse {
  results?: CslResult[];
}

export class SanctionsAgent {
  private apiKey = process.env.TRADE_GOV_API_KEY;

  async run(name: string): Promise<{ matches: SanctionsMatch[]; sources: Source[] }> {
    if (!this.apiKey) return { matches: [], sources: [] };

    try {
      const res = await fetch(
        `${CSL_BASE}?api_key=${this.apiKey}&name=${encodeURIComponent(name)}&fuzzy_name=true`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[sanctions-agent] "${name}" — HTTP ${res.status}`);
        return { matches: [], sources: [] };
      }

      // trade.gov occasionally returns a 200 with an HTML maintenance/WAF
      // page instead of JSON — res.ok alone doesn't catch that, and
      // res.json() throwing a raw SyntaxError on "<!DOCTYPE ..." reads
      // like a real bug in the logs. Treat it the same as a bad status.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        console.warn(`[sanctions-agent] "${name}" — non-JSON response (content-type: "${contentType}"), treating as unavailable`);
        return { matches: [], sources: [] };
      }

      const data = (await res.json()) as CslResponse;
      const results = data.results ?? [];

      const matches: SanctionsMatch[] = results
        .filter((r): r is CslResult & { name: string; source: string } => Boolean(r.name && r.source))
        .slice(0, 10)
        .map((r) => ({
          name: r.name,
          source: r.source,
          type: r.type,
          programs: r.programs,
          remarks: r.remarks,
          url: r.id ? `https://www.trade.gov/consolidated-screening-list` : undefined,
        }));

      const sources: Source[] = matches.length > 0
        ? [{
            url: "https://www.trade.gov/consolidated-screening-list",
            title: `Consolidated Screening List — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["sanctions"],
          }]
        : [];

      console.log(`[sanctions-agent] "${name}" — ${matches.length} possible match(es)`);

      return { matches, sources };
    } catch (err) {
      console.warn(`[sanctions-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { matches: [], sources: [] };
    }
  }
}
