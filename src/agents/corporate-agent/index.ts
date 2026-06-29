import {
  CorporateAgentResult,
  FundingEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { splitSentences } from "../../lib/nlp.js";
import { FundingExtractionSchema, extractStructured } from "../../lib/llm.js";

const AMOUNT_RE = /\$\s?\d+(?:[.,]\d+)?\s?(?:million|billion|M|B|K)\b/i;
const ROUND_RE = /\b(Pre-[Ss]eed|[Ss]eed|Series [A-F])\b/;
const FUNDING_CONTEXT_RE = /\b(raised|raises|funding round|secured|closed a|investment of)\b/i;

/**
 * Corporate Agent
 * Collects: funding history, ownership signals.
 *
 * Tries a local LLM (Ollama) first — it can correctly pair an amount
 * with its actual round even across messy, table-flattened source text
 * (the "Seed: $9.81B" mismatch bug heuristics couldn't fully solve).
 * Falls back to sentence-scoped regex extraction if Ollama isn't
 * available or the call fails. See lib/llm.ts for the fallback policy.
 */
export class CorporateAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(companyName: string): Promise<CorporateAgentResult> {
    const results = await this.searcher.search(
      `${companyName} funding round investors raised`,
      5
    );

    const sources: Source[] = results.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["funding"],
    }));

    const combinedText = results
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    let funding: FundingEntry[] = [];
    let ownership: string | undefined;

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a business research assistant extracting funding history for the company "${companyName}" from search results. Only extract actual funding ROUNDS (raised/secured money), not valuation figures or unrelated dollar amounts.`,
        combinedText,
        FundingExtractionSchema
      );

      if (llmResult) {
        if (llmResult.funding) {
          funding = llmResult.funding.map((f) => ({
            round: f.round,
            amount: f.amount,
            date: f.date,
          }));
        }
        ownership = llmResult.ownership;
      }
    }

    if (funding.length === 0) {
      const seen = new Set<string>();
      for (const r of results) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        const sentences = splitSentences(text);

        for (const sentence of sentences) {
          const amountMatch = sentence.match(AMOUNT_RE);
          if (!amountMatch) continue;
          if (!FUNDING_CONTEXT_RE.test(sentence)) continue;

          const roundMatch = sentence.match(ROUND_RE);
          const amount = amountMatch[0];
          const round = roundMatch?.[0];

          const key = `${round ?? ""}-${amount}`;
          if (seen.has(key)) continue;
          seen.add(key);

          funding.push({ round, amount });
        }
      }
    }

    if (!ownership) {
      const ownershipSignal = results.find((r) =>
        /\b(subsidiary of|owned by|parent company|acquired by)\b/i.test(
          `${r.title} ${r.snippet ?? ""}`
        )
      );
      ownership = ownershipSignal?.snippet;
    }

    return { funding, ownership, sources };
  }
}
