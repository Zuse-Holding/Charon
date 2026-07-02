import {
  CompetitorAgentResult,
  CompetitorEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { extractOrganizations } from "../../lib/nlp.js";
import { CompetitorExtractionSchema, extractStructured } from "../../lib/llm.js";

const NON_COMPETITOR_ENTITIES = new Set([
  // Social media platforms
  "youtube", "facebook", "instagram", "tiktok", "twitter", "x", "linkedin",
  "reddit", "pinterest", "snapchat", "whatsapp", "telegram", "discord",
  // Media / publishers
  "bloomberg", "forbes", "techcrunch", "business insider", "the verge",
  "wired", "cnn", "bbc", "reuters", "ap", "wsj", "new york times",
  "medium", "substack", "crunchbase", "wikipedia",
  // General tech platforms / infrastructure
  "google", "apple", "microsoft", "amazon", "meta", "netflix", "spotify",
  "uber", "airbnb", "salesforce", "oracle", "sap", "ibm", "adobe",
  // Generic non-company terms
  "app store", "play store", "github", "slack", "zoom", "notion",
]);

/**
 * Competitor Agent
 * Collects: named rivals/alternatives for the researched company.
 * Only returns direct market competitors — not media platforms, social
 * networks, or generic enterprise software unless the company being
 * researched is itself in one of those categories.
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
        `You are a business research assistant identifying direct competitor companies to "${companyName}" from search results.

STRICT RULES:
- Only include companies that directly compete for the same customers in the same market segment as "${companyName}"
- NEVER include: social media platforms (Facebook, YouTube, Instagram, TikTok, Twitter/X, LinkedIn), news/media publishers (Bloomberg, Forbes, TechCrunch), general search engines (Google), general cloud/infrastructure providers (AWS, Azure, GCP) unless "${companyName}" IS one of those categories
- NEVER include "${companyName}" itself
- NEVER include companies that are merely mentioned in an article alongside "${companyName}" without being a direct competitor
- If you are not confident a company is a direct competitor, exclude it
- Return 3-8 genuine direct competitors only`,
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
