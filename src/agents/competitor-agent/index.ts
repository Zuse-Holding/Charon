import {
  CompetitorAgentResult,
  CompetitorEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { extractOrganizations } from "../../lib/nlp.js";
import { CompetitorExtractionSchema, extractStructured } from "../../lib/llm.js";

const NON_COMPETITOR_ENTITIES = new Set([
  "youtube", "bloomberg", "tiktok", "twitter", "x", "facebook", "instagram",
  "linkedin", "reddit", "medium", "forbes", "techcrunch", "business insider",
  "wikipedia", "google",
]);

/**
 * Competitor Agent
 * Collects: named rivals/alternatives for the researched company.
 *
 * Tries a local LLM (Ollama) first — better recall than the NLP
 * org-tagging heuristic (which is conservative and misses real
 * competitors), without the false positives of raw regex. Falls back
 * to NLP org-tagging if Ollama isn't available.
 */
export class CompetitorAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(companyName: string): Promise<CompetitorAgentResult> {
    const results = await this.searcher.search(
      `${companyName} top competitors and alternatives`,
      5
    );

    const sources: Source[] = results.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["competitors"],
    }));

    const combinedText = results
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    let competitors: CompetitorEntry[] = [];

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a business research assistant identifying real competitor/alternative companies to "${companyName}" from search results. Do not include media platforms, publishers, or "${companyName}" itself.`,
        combinedText,
        CompetitorExtractionSchema
      );

      if (llmResult?.competitors) {
        competitors = llmResult.competitors
          .filter((c) => c.name.toLowerCase() !== companyName.toLowerCase())
          .slice(0, 8)
          .map((c) => ({ name: c.name }));
      }
    }

    if (competitors.length === 0) {
      const nameCounts = new Map<string, { count: number; sourceUrl: string }>();

      for (const r of results) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        const names = extractOrganizations(text, companyName);
        for (const name of names) {
          if (NON_COMPETITOR_ENTITIES.has(name.toLowerCase())) continue;
          const existing = nameCounts.get(name);
          if (existing) {
            existing.count += 1;
          } else {
            nameCounts.set(name, { count: 1, sourceUrl: r.url });
          }
        }
      }

      competitors = Array.from(nameCounts.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8)
        .map(([name, info]) => ({
          name,
          url: info.sourceUrl,
          note: info.count > 1 ? `mentioned in ${info.count} sources` : undefined,
        }));
    }

    return { competitors, sources };
  }
}
