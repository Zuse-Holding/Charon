import {
  NewsEntry,
  ProductResearchBundle,
  ProductSpec,
  ProductCompetitorEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { extractStructured, ProductEntityExtractionSchema, ProConsVerdictSchema } from "../../lib/llm.js";

/**
 * Product Agent
 * Researches a specific product — specs, pricing, manufacturer/brand,
 * product-level competitors, recent news.
 *
 * Key distinction from Company Agent: competitors here are other
 * PRODUCTS, not companies. "PlayStation 5" competes with "Xbox Series X"
 * and "Nintendo Switch", not "Sony" competing with "Microsoft".
 */
export class ProductAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(productName: string): Promise<ProductResearchBundle> {
    // Four parallel searches — including a dedicated brand/manufacturer
    // search so the LLM has explicit data to pull the parent company from.
    const [overviewResults, specsResults, competitorResults, newsResults] =
      await Promise.all([
        this.searcher.search(`${productName} manufacturer brand company made by`, 3),
        this.searcher.search(`${productName} specs price features review`, 5),
        this.searcher.search(`${productName} alternatives competitors vs comparison`, 5),
        this.searcher.search(`${productName} news 2026`, 5),
      ]);

    const sources: Source[] = [
      ...overviewResults, ...specsResults,
      ...competitorResults, ...newsResults,
    ].map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["product"],
    }));

    const overviewText  = overviewResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n");
    const specsText     = specsResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n");
    const competitorText = competitorResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n");
    const combinedText  = `OVERVIEW & BRAND:\n${overviewText}\n\nSPECS & PRICING:\n${specsText}`;

    const [extraction, risksResult] = await Promise.all([
      extractStructured(
        `You are a product research assistant extracting structured facts about "${productName}".

Extract:
- brand: the manufacturer or parent company (e.g. "Sony" for PlayStation 5, "Apple" for iPhone 15, "Microsoft" for Xbox Series X). This is the COMPANY that makes the product, not the product line name.
- category: what type of product it is (e.g. "Gaming Console", "Electric Vehicle", "Smartphone")
- description: 1-2 sentence summary of what the product is and who it's for
- price: starting/base retail price as a string (e.g. "$499.99")
- specs: array of key technical specs as {label, value} pairs (e.g. {label: "Storage", value: "825GB SSD"})
- competitors: array of competing PRODUCTS (not companies) as {name, note} pairs

Be specific about the brand — always identify the parent company.`,
        combinedText,
        ProductEntityExtractionSchema
      ),
      extractStructured(
        `You are a product reviewer writing a Pros, Cons, and Verdict assessment for "${productName}".

RULES:
- pros: 3-5 specific strengths based on the actual specs, price, and reviews. Reference real features.
- cons: 3-5 specific weaknesses or limitations. Be direct — mention real complaints from reviews if available.
- verdict: one clear paragraph on who should buy this product and why. Mention the best use case and who it's not for. No filler phrases.

Be specific and direct. If review data is thin, say so rather than padding.`,
        combinedText + "\n\nCOMPETITORS:\n" + competitorText,
        ProConsVerdictSchema
      ),
    ]);

    const specs: ProductSpec[] = extraction?.specs ?? [];
    const competitors: ProductCompetitorEntry[] = extraction?.competitors?.map((c) => ({
      name: c.name,
      note: c.note,
    })) ?? [];

    const news: NewsEntry[] = newsResults.map((r) => ({
      headline: r.title,
      summary: r.snippet,
      url: r.url,
    }));

    // Heuristic brand fallback — if LLM didn't extract it, check if
    // the product name itself contains common brand prefixes
    const knownBrands: [RegExp, string][] = [
      [/playstation|ps5|ps4/i, "Sony"],
      [/xbox/i, "Microsoft"],
      [/iphone|ipad|macbook|airpods/i, "Apple"],
      [/galaxy|samsung/i, "Samsung"],
      [/pixel/i, "Google"],
      [/tesla/i, "Tesla"],
      [/nintendo|switch/i, "Nintendo"],
    ];
    let brand = extraction?.brand;
    if (!brand) {
      for (const [re, b] of knownBrands) {
        if (re.test(productName)) { brand = b; break; }
      }
    }

    return {
      query: productName,
      generatedAt: new Date().toISOString(),
      product: {
        name: productName,
        brand,
        category: extraction?.category,
        price: extraction?.price,
        description: extraction?.description,
      },
      specs,
      competitors,
      news,
      pros: (risksResult?.pros ?? []) as string[],
      cons: (risksResult?.cons ?? []) as string[],
      verdict: risksResult?.verdict as string | undefined,
      sources,
    };
  }
}
