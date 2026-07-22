import {
  CorporateAgentResult,
  FundingEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { splitSentences } from "../../lib/nlp.js";
import { FundingExtractionSchema, extractStructured } from "../../lib/llm.js";
import { Form4Agent } from "../form4-agent/index.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

const AMOUNT_RE = /\$\s?\d+(?:[.,]\d+)?\s?(?:million|billion|M|B|K)\b/i;
const ROUND_RE = /\b(Pre-[Ss]eed|[Ss]eed|Series [A-F])\b/;
const FUNDING_CONTEXT_RE = /\b(raised|raises|funding round|secured|closed a|investment of)\b/i;

/**
 * Corporate Agent
 * Collects: funding history, ownership signals.
 *
 * Fetches full page text for the top funding search results (not just
 * snippets) for richer context — same pattern as people-agent/news-agent.
 *
 * Tries a local LLM (Ollama) first — it can correctly pair an amount
 * with its actual round even across messy, table-flattened source text
 * (the "Seed: $9.81B" mismatch bug heuristics couldn't fully solve).
 * Falls back to sentence-scoped regex extraction (over snippets — cheap
 * and reliable, doesn't need the fetched full text) if Ollama isn't
 * available or the call fails. See lib/llm.ts for the fallback policy.
 */
export class CorporateAgent {
  private form4Agent: Form4Agent;

  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {
    this.form4Agent = new Form4Agent(searcher, fetcher);
  }

  async run(companyName: string): Promise<CorporateAgentResult> {
    // 7/20 fix — this agent used to have no awareness of the entity
    // override registry at all, so a funding round or ownership note
    // sourced from a known-wrong domain (e.g. alan.com when researching
    // "Alan Health") could reach the LLM prompt and the final report
    // even when website-agent's own output was correctly filtered.
    // Excluding at the query itself (-site:) plus dropping any
    // rejected-domain result that still slips through, before any
    // full-text fetch or prompt assembly, closes that gap the same way
    // website-agent's filter does for company overview/leadership/products.
    const override = findOverride(companyName);

    const [rawResults, form4Result] = await Promise.all([
      this.searcher.search(appendDomainExclusions(`${companyName} funding round investors raised parent company subsidiary`, override), 5),
      // Insider activity (Round 2, item 5) — same "who owns/controls this
      // company" question funding/ownership already answers here.
      this.form4Agent.run(companyName),
    ]);

    const results = rawResults.filter((r) => !isRejectedDomain(r.url, override));

    const sources: Source[] = results.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["funding"],
    }));

    // Fetch full page text for the top results — funding articles often
    // bury the actual round/amount pairing below what a snippet captures,
    // same pattern as people-agent/news-agent.
    const fetchedPages = await Promise.all(
      results.slice(0, 3).map((r) => fetchPageText(r.url, this.fetcher, 2500))
    );
    const fullTextBlock = fetchedPages
      .map((text, i) => (text ? `FULL PAGE (${results[i].url}):\n${text}` : ""))
      .filter(Boolean)
      .join("\n\n");
    // Snippets only for results that didn't get full text — a source
    // already included as a full page doesn't need its snippet repeated.
    const snippetBlock = results
      .filter((_r, i) => i >= 3 || !fetchedPages[i])
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");
    const combinedText = [fullTextBlock, snippetBlock].filter(Boolean).join("\n\n");

    let funding: FundingEntry[] = [];
    let ownership: string | undefined;

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a business research assistant extracting funding history and ownership structure for the company "${companyName}" from search results. Only extract actual funding ROUNDS (raised/secured money), not valuation figures or unrelated dollar amounts. Also set "ownership" to a short note if the text says this company is a subsidiary of, owned by, or a division of another company (e.g. "Owned by Warner Bros. Discovery" or "Subsidiary of VF Corporation") — leave it unset if no such relationship is mentioned.`,
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

    return {
      funding,
      ownership,
      insiderActivity: form4Result.filings,
      sources: [...sources, ...form4Result.sources],
    };
  }
}
