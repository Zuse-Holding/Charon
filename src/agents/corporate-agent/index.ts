import { anchorSuffix, tiedToSubject, type SubjectRecord } from "../../lib/entities/subject.js";
import { namesItself } from "../../lib/news-noise.js";
import {
  CorporateAgentResult,
  FundingEntry,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { splitSentences } from "../../lib/nlp.js";
import { isValuation } from "../../lib/gap-fill.js";
import { FundingExtractionSchema, extractStructured } from "../../lib/llm.js";
import { Form4Agent } from "../form4-agent/index.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

/**
 * Funding, complete and clean (launch fix 27): amounts under $50K are
 * prizes or grants, not rounds (Gecko's $10K and $7.5K "seed" rounds); the
 * same round listed twice keeps one entry, the dated and larger one; and
 * rounds run newest first.
 */
/** The text has the company investing in or backing another one, and never raising itself. */
export function investsIn(text: string, name: string): boolean {
  const n = name.replace(/,?\s+(inc\.?|llc|corp\.?|co\.?|company)$/i, "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return false;
  const raises = new RegExp(`\\b${n}(?:['’]s)?\\s+(?:\\w+\\s+){0,2}?(raises|raised|secures|secured|closes|closed|lands|landed|nets)\\b`, "i");
  if (raises.test(text)) return false;
  const investor = new RegExp(`\\b${n}(?:['’]s)?\\s+(?:[\\w&,'’-]+\\s+){0,3}?(invests?|invested|backs|backed|leads|led|joins|joined|participat\\w+)\\b|\\b(led by|backed by|investors? (?:such as|like|including|include)|participation (?:of|from)|with participation from)\\s+(?:[\\w&.,'’-]+\\s+){0,6}?${n}\\b|\\b${n}-backed\\b`, "i");
  return investor.test(text);
}

export function cleanFunding(entries: FundingEntry[]): FundingEntry[] {
  const dollars = (a?: string) => {
    const m = a?.match(/\$\s?(\d+(?:[.,]\d+)?)\s*(billion|bn|b|million|mm|m|thousand|k)?\b/i);
    if (!m) return undefined;
    const unit = (m[2] ?? "").toLowerCase();
    return Number(m[1].replace(/,/g, "")) * (unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit === "k" || unit === "thousand" ? 1e3 : 1);
  };
  const time = (d?: string) => {
    const t = d ? Date.parse(/^\d{4}$/.test(d) ? `${d}-07-01` : d) : NaN;
    return isNaN(t) ? 0 : t;
  };
  const key = (f: FundingEntry) => (f.round ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(round|funding)\b/g, "").trim();
  const kept = new Map<string, FundingEntry>();
  for (const f of entries) {
    const amount = dollars(f.amount);
    if (amount !== undefined && amount < 50_000) continue;
    // An amount with no round name and no investors is usually something
    // else: a facility investment, a contract (launch fix 64: ACCO's
    // "Round: $36 million" was a new building).
    if ((!f.round || /^(round|funding|investment)$/i.test(f.round.trim())) && !f.investors?.length) continue;
    const k = key(f) || `${f.amount}-${f.date}`;
    const prev = kept.get(k);
    if (!prev || (time(f.date) > 0 && time(prev.date) === 0) || (dollars(f.amount) ?? 0) > (dollars(prev.amount) ?? 0)) kept.set(k, f);
  }
  return [...kept.values()].sort((a, b) => time(b.date) - time(a.date));
}

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

  /** @param subject The resolved company (Fix 1/Fix 3): the search is
   *  narrowed to its city, and funding is read only from sources tied to
   *  it, so a larger namesake's rounds can't land here. */
  async run(companyName: string, subject: SubjectRecord = { name: companyName, anchor: {} }): Promise<CorporateAgentResult> {
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

    const [olderResults, recentResults, newsResults, form4Result] = await Promise.all([
      this.searcher.search(appendDomainExclusions(`${companyName}${anchorSuffix(subject.anchor)} funding round investors raised parent company subsidiary`, override), 5),
      // The latest rounds (launch fix 27): Gecko stopped at a 2022 Series C,
      // missing its Dec 2023 extension and Jun 2025 Series D.
      this.searcher.search(appendDomainExclusions(`"${companyName}" raises Series funding valuation latest round`, override), 5),
      // The news index has the latest rounds the web index buries (launch
      // fix 47: Gecko still stopped at its 2022 Series C).
      this.searcher.news ? this.searcher.news(`"${companyName}" raises funding round`, 8) : Promise.resolve([]),
      // Insider activity (Round 2, item 5) — same "who owns/controls this
      // company" question funding/ownership already answers here.
      this.form4Agent.run(companyName, subject.ticker),
    ]);

    const seenUrl = new Set<string>();
    const rawResults = [...newsResults, ...recentResults, ...olderResults].filter((r) => !seenUrl.has(r.url) && seenUrl.add(r.url));
    const results = rawResults
      .filter((r) => !isRejectedDomain(r.url, override))
      .filter((r) => tiedToSubject(`${r.title} ${r.snippet ?? ""}`, r.url, subject))
      // Rounds of the company itself, not of a longer name containing it
      // (launch fix 57: "Patagonia Health" rounds landed on Patagonia).
      .filter((r) => [subject.name, ...(subject.aliases ?? [])].some((n) => namesItself(`${r.title} ${r.snippet ?? ""}`, n)))
      // A round it invested in is someone else's (launch fix 78: "Patagonia
      // and H&M invest in Rubi" became Patagonia's own $8M round).
      .filter((r) => ![subject.name, ...(subject.aliases ?? [])].some((n) => investsIn(`${r.title}. ${r.snippet ?? ""}`, n)));

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
        `You are a business research assistant extracting funding history and ownership structure for the company "${companyName}" from search results. Only extract actual equity or venture funding ROUNDS (raised/secured money), with the date each was announced, every round through the most recent. Never include prizes, competition winnings, grants, SBIR or government awards, loans, or valuation figures on their own; an extension of a round is its own entry (e.g. "Series C extension"). Also set "ownership" to a short note if the text says this company is a subsidiary of, owned by, or a division of another company (e.g. "Owned by Warner Bros. Discovery" or "Subsidiary of VF Corporation") — leave it unset if no such relationship is mentioned.`,
        combinedText,
        FundingExtractionSchema
      );

      if (llmResult) {
        if (llmResult.funding) {
          // A valuation read as the round's size is dropped (round 12).
          funding = llmResult.funding
            .filter((f) => !f.amount || !isValuation(combinedText, f.amount))
            .map((f) => ({
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
          if (isValuation(sentence, amount)) continue;

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
      funding: cleanFunding(funding),
      ownership,
      insiderActivity: form4Result.filings,
      sources: [...sources, ...form4Result.sources],
    };
  }
}
