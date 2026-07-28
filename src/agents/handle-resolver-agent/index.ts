import { HandleResolutionCandidate, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { HandleProfileExtraction, HandleProfileExtractionSchema, extractStructured } from "../../lib/llm.js";
import { looksLikePersonName } from "../../entity-validation.js";
import { WaybackAgent } from "../wayback-agent/index.js";

/**
 * Handle Resolver Agent (Person Search evidence source) — resolves a bare
 * username/handle to real-name candidates. An additional evidence source
 * alongside opencorporates-agent/openfec-agent/courtlistener-agent, not a
 * separate creator vertical: no audience/engagement/monetization fields
 * here, see src/agents/creator-signal-agent for that.
 *
 * Stage 1 — parallel, domain-gated Serper search per platform
 * (site:github.com/twitter.com/x.com/instagram.com/reddit.com) plus two
 * direct-fetch personal-domain guesses ({handle}.com/.dev).
 * Stage 2 — for each hit, extract bio text (full page where fetchable,
 * snippet otherwise — same pattern as opencorporates-agent's search
 * fallback) plus outbound links, and follow one hop on those links
 * (Linktree, personal site, LinkedIn) for a name.
 * Stage 3 — for confirmed platform profile URLs only (never the domain
 * guesses), check the earliest Wayback Machine snapshot for a name shown
 * historically but not on the current page. wayback-agent's doc comment
 * explains why it isn't wired into general person research (no reliable
 * canonical URL for an arbitrary person) — that objection doesn't apply
 * here because a confirmed platform hit (not a guess) already IS a
 * canonical URL for this handle.
 * Stage 4 — group extracted names, apply src/entity-validation.ts's
 * looksLikePersonName shape check, and score confidence.
 *
 * Confidence:
 *   high   — 2+ independent confirmed platforms agree on the same name.
 *   medium — exactly 1 confirmed platform produced the name.
 *   low    — only weak signals (personal-domain guess, an outbound-link
 *            hop, or a Wayback delta) — no platform-confirmed source.
 * Every candidate always carries its full sourceUrls audit trail — never a
 * bare name with nothing backing it.
 *
 * Same fail-open pattern as every other Person Research evidence agent: a
 * bad request, timeout, or network error returns empty results, never
 * throws.
 */

const RESULTS_PER_PLATFORM = 2;
const MAX_OUTBOUND_HOPS = 3;
const MAX_WAYBACK_CHECKS = 2;

const PLATFORM_QUERIES: { platform: string; queries: (handle: string) => string[] }[] = [
  { platform: "github", queries: (h) => [`site:github.com "${h}"`] },
  // Twitter/X — one platform, two domains (the site never re-indexed old
  // twitter.com URLs after the rename), so both queries share a platform
  // label and don't inflate the "independent platform" count in scoring.
  { platform: "twitter", queries: (h) => [`site:twitter.com "${h}"`, `site:x.com "${h}"`] },
  { platform: "instagram", queries: (h) => [`site:instagram.com "${h}"`] },
  { platform: "reddit", queries: (h) => [`site:reddit.com "${h}"`] },
];

function platformLabel(platform: string): string {
  switch (platform) {
    case "github": return "GitHub";
    case "twitter": return "Twitter/X";
    case "instagram": return "Instagram";
    case "reddit": return "Reddit";
    case "personal-domain": return "personal site guess";
    default: return platform;
  }
}

interface RawHit {
  platform: string;
  url: string;
  title: string;
  snippet?: string;
}

interface NameHit {
  name: string;
  platform: string; // one of PLATFORM_QUERIES' platforms, or "personal-domain" | "outbound-link" | "wayback"
  strong: boolean;   // true = confirmed site:-gated platform hit; false = domain guess / outbound hop / wayback corroboration
  sourceUrl: string;
  evidence: string;
}

const EXTRACTION_RULES = `RULES:
- Only set "name" if the page EXPLICITLY states a real name — an "About" line, a bio sentence ("Hi, I'm ___"), a page title with a full name, etc. Never guess or infer a name from writing style, tone, or context.
- If no real name is explicitly stated, leave "name" unset — do not fabricate one.
- "outboundLinks": any links on the page pointing to Linktree, a personal domain, or LinkedIn (full URLs only). Omit navigation/ad/platform-internal links.`;

export class HandleResolverAgent {
  constructor(
    private searcher: SearchProvider,
    private fetcher: FetchProvider,
    private wayback: WaybackAgent = new WaybackAgent()
  ) {}

  async run(handle: string): Promise<{ candidates: HandleResolutionCandidate[]; sources: Source[] }> {
    const cleanHandle = handle.trim().replace(/^@/, "");
    if (!cleanHandle) return { candidates: [], sources: [] };

    try {
      const platformHits = await this.searchPlatforms(cleanHandle);
      const domainHits = await this.fetchDomainGuesses(cleanHandle);
      const allHits = [...platformHits, ...domainHits];

      if (allHits.length === 0) {
        console.log(`[handle-resolver-agent] "${cleanHandle}" — no hits on any platform or domain guess`);
        return { candidates: [], sources: [] };
      }

      const sources: Source[] = allHits.map((h) => ({
        url: h.url,
        title: h.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["handle-resolution"],
      }));

      const nameHits: NameHit[] = [];
      const outboundLinks: { url: string; fromPlatform: string }[] = [];

      await Promise.all(
        allHits.map(async (hit) => {
          const extraction = await this.extractFromPage(hit.url, hit.snippet);
          if (!extraction) return;
          if (extraction.name && looksLikePersonName(extraction.name)) {
            nameHits.push({
              name: extraction.name,
              platform: hit.platform,
              strong: hit.platform !== "personal-domain",
              sourceUrl: hit.url,
              evidence: `${platformLabel(hit.platform)} bio/profile text`,
            });
          }
          for (const link of extraction.outboundLinks.slice(0, 2)) {
            if (outboundLinks.length < MAX_OUTBOUND_HOPS) outboundLinks.push({ url: link, fromPlatform: hit.platform });
          }
        })
      );

      // One hop on outbound links (Linktree, personal site, LinkedIn).
      await Promise.all(
        outboundLinks.map(async (link) => {
          const extraction = await this.extractFromPage(link.url);
          if (!extraction?.name || !looksLikePersonName(extraction.name)) return;
          nameHits.push({
            name: extraction.name,
            platform: "outbound-link",
            strong: false,
            sourceUrl: link.url,
            evidence: `Outbound link from ${platformLabel(link.fromPlatform)} profile`,
          });
          sources.push({
            url: link.url,
            title: `Outbound link from ${platformLabel(link.fromPlatform)} profile`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["handle-resolution"],
          });
        })
      );

      // Stage 3 — Wayback delta check, confirmed platform profile URLs
      // only, bounded so a handle with hits everywhere doesn't chain into
      // a slow run of archive fetches.
      const confirmedProfileUrls = platformHits.map((h) => h.url).slice(0, MAX_WAYBACK_CHECKS);
      for (const url of confirmedProfileUrls) {
        const waybackHit = await this.checkWaybackDelta(url);
        if (waybackHit) {
          nameHits.push(waybackHit.nameHit);
          sources.push(waybackHit.source);
        }
      }

      const candidates = this.scoreCandidates(nameHits);
      console.log(`[handle-resolver-agent] "${cleanHandle}" — ${allHits.length} hit(s), ${candidates.length} name candidate(s)`);

      return { candidates, sources };
    } catch (err) {
      console.warn(`[handle-resolver-agent] "${cleanHandle}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { candidates: [], sources: [] };
    }
  }

  private async searchPlatforms(handle: string): Promise<RawHit[]> {
    const results = await Promise.all(
      PLATFORM_QUERIES.map(async ({ platform, queries }) => {
        const perQuery = await Promise.all(queries(handle).map((q) => this.searcher.search(q, RESULTS_PER_PLATFORM)));
        return perQuery.flat().map((h) => ({ platform, url: h.url, title: h.title, snippet: h.snippet }));
      })
    );
    return results.flat();
  }

  private async fetchDomainGuesses(handle: string): Promise<RawHit[]> {
    const guesses = [`https://${handle}.com`, `https://${handle}.dev`];
    const results = await Promise.all(
      guesses.map(async (url) => {
        const text = await this.fetcher.fetchText(url);
        return text ? { platform: "personal-domain", url, title: `${handle} — personal site guess` } : null;
      })
    );
    return results.filter((r): r is RawHit => r !== null);
  }

  private async extractFromPage(url: string, snippet?: string): Promise<HandleProfileExtraction | null> {
    const pageText = await fetchPageText(url, this.fetcher, 2000);
    const text = pageText ?? snippet;
    if (!text) return null;

    return extractStructured(
      `You are extracting identity info from a single social/personal-site profile page for handle resolution.\n\n${EXTRACTION_RULES}`,
      text,
      HandleProfileExtractionSchema
    );
  }

  private async checkWaybackDelta(profileUrl: string): Promise<{ nameHit: NameHit; source: Source } | null> {
    try {
      const { summary } = await this.wayback.run(profileUrl);
      if (!summary.firstSnapshot) return null;

      const archivedText = await fetchPageText(summary.firstSnapshot.url, this.fetcher, 2000);
      if (!archivedText) return null;

      const extraction = await extractStructured(
        `You are extracting identity info from an ARCHIVED (historical) snapshot of a social/personal-site profile page for handle resolution.\n\n${EXTRACTION_RULES}`,
        archivedText,
        HandleProfileExtractionSchema
      );

      if (!extraction?.name || !looksLikePersonName(extraction.name)) return null;

      return {
        nameHit: {
          name: extraction.name,
          platform: "wayback",
          strong: false,
          sourceUrl: summary.firstSnapshot.url,
          evidence: `Wayback snapshot (${summary.firstSnapshot.timestamp.slice(0, 4)}) named the account holder`,
        },
        source: {
          url: summary.firstSnapshot.url,
          title: `Wayback Machine — earliest snapshot of ${profileUrl}`,
          retrievedAt: new Date().toISOString(),
          usedFor: ["handle-resolution"],
        },
      };
    } catch {
      return null;
    }
  }

  private scoreCandidates(hits: NameHit[]): HandleResolutionCandidate[] {
    const groups = new Map<string, NameHit[]>();
    for (const hit of hits) {
      const key = hit.name.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(hit);
    }

    const rank = { high: 0, medium: 1, low: 2 } as const;

    const candidates: HandleResolutionCandidate[] = [...groups.values()].map((group) => {
      const strongPlatforms = new Set(group.filter((h) => h.strong).map((h) => h.platform));
      const confidence: HandleResolutionCandidate["confidence"] =
        strongPlatforms.size >= 2 ? "high" : strongPlatforms.size === 1 ? "medium" : "low";

      return {
        name: group[0].name,
        confidence,
        platforms: [...new Set(group.map((h) => h.platform))],
        profileUrls: [...new Set(group.filter((h) => h.strong).map((h) => h.sourceUrl))],
        evidence: group[0].evidence,
        sourceUrls: [...new Set(group.map((h) => h.sourceUrl))],
      };
    });

    return candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.sourceUrls.length - a.sourceUrls.length);
  }
}
