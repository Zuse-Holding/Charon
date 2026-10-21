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
 * register + subscribe to "Consolidated Screening List API"), sent as the
 * `subscription-key` header. The old api.trade.gov host (key in the query
 * string) now serves an expired TLS certificate, which Node reports as
 * "fetch failed" (Oct 20, 2026). A missing key or a failed lookup returns
 * `unavailable: true`, so the report says screening didn't run instead of
 * reading as "no matches".
 *
 * A match here is not an accusation — sanctions lists include historical/
 * delisted entries and name collisions happen constantly (common names,
 * transliteration variants). Always surfaced as "possible sanctions list
 * match," never asserted as fact.
 */

const CSL_BASE = "https://data.trade.gov/consolidated_screening_list/v1/search";

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

  async run(name: string): Promise<{ matches: SanctionsMatch[]; sources: Source[]; unavailable?: boolean }> {
    const unavailable = { matches: [], sources: [], unavailable: true };
    if (!this.apiKey) {
      console.warn("[sanctions-agent] TRADE_GOV_API_KEY not set — screening unavailable");
      return unavailable;
    }

    try {
      const res = await fetch(
        `${CSL_BASE}?name=${encodeURIComponent(name)}&fuzzy_name=true`,
        { headers: { "subscription-key": this.apiKey }, signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[sanctions-agent] "${name}" — HTTP ${res.status}`);
        return unavailable;
      }

      // trade.gov occasionally returns a 200 with an HTML maintenance/WAF
      // page instead of JSON — res.ok alone doesn't catch that, and
      // res.json() throwing a raw SyntaxError on "<!DOCTYPE ..." reads
      // like a real bug in the logs. Treat it the same as a bad status.
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        console.warn(`[sanctions-agent] "${name}" — non-JSON response (content-type: "${contentType}"), treating as unavailable`);
        return unavailable;
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
      // "fetch failed" alone hides the cause (DNS, TLS, refused): log it so
      // a host that can't reach data.trade.gov shows why (round 2, Fix 7).
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      console.warn(`[sanctions-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err,
        cause ? `(${cause.code ?? ""} ${cause.message ?? ""})`.trim() : "");
      return unavailable;
    }
  }
}
