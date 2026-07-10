import { Form4Entry, Source } from "../../types/research.js";
import { SearchProvider } from "../../lib/providers.js";
import { Form4ExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * Form 4 Agent (Round 2, item 5) — insider trading activity.
 *
 * SEC EDGAR does have a real structured path here (submissions API for
 * CIK resolution + browse-edgar for the filing list), but the actual
 * transaction detail (buy/sell, share counts, dollar value) only lives
 * inside each individual Form 4's XML ownership document, which needs
 * real XML-schema parsing (nonDerivativeTable/derivativeTable, transaction
 * codes P/S/A/etc.) to extract correctly. That's a meaningfully bigger,
 * riskier build to get right without being able to test against a live
 * filing in this environment, so this ships the same
 * search-and-synthesize pattern the rest of this codebase already uses
 * successfully (see political-agent, corporate-agent) — real recent
 * insider-activity data, sourced from SEC filing news/coverage and
 * EDGAR's own indexed pages, without new API keys or fragile XML parsing.
 * Swapping in raw EDGAR XML parsing later is a valid v2 (see note below).
 */
/**
 * Rejects names that clearly aren't a real full name: single tokens
 * ("John", "S" — both seen in production output from a Lockheed Martin
 * run, where search snippets got cut off mid-name), bare initials, or
 * anything containing digits. Mirrors the person-name heuristic in
 * src/entity-validation.ts. This can't catch a well-formed but *wrong*
 * name (a real person's full name who just isn't actually associated
 * with this company) — that's handled by the prompt requiring same-
 * snippet grounding below, not by a regex.
 */
function looksLikeFullPersonName(name: string): boolean {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  if (/\d/.test(name)) return false;
  return tokens.every((t) => /^[A-Z][a-zA-Z'.-]*$/.test(t));
}

export class Form4Agent {
  constructor(private searcher: SearchProvider) {}

  async run(companyName: string): Promise<{ filings: Form4Entry[]; sources: Source[] }> {
    const results = await this.searcher.search(
      `${companyName} Form 4 insider trading SEC filing officer director buy sell shares`,
      6
    );

    if (results.length === 0) return { filings: [], sources: [] };

    const sources: Source[] = results.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["insider-activity"],
    }));

    // Numbered + clearly bounded per source, so the LLM can't blend a
    // name from one snippet with a company/role mentioned in another —
    // a real failure mode seen in production (a US Steel executive's
    // name got attributed to a Lockheed Martin insider transaction from
    // an unrelated snippet in the same batch).
    const combinedText = results
      .map((r, i) => `SOURCE ${i + 1} (${r.url}):\nTitle: ${r.title}\nSnippet: ${r.snippet ?? ""}`)
      .join("\n\n");

    const llmResult = await extractStructured(
      `You are a financial research assistant extracting insider trading activity (SEC Form 4 filings) specifically for "${companyName}" from search results.

RULES:
- Only include a transaction if the SAME numbered source explicitly names both the person AND ties them to "${companyName}" (as an officer, director, or 10% owner of this specific company). Never combine a name from one source with a role or company mentioned in a different source.
- filerName: the insider's FULL name (first and last name at minimum) exactly as it appears in that source. Never return a single word, a bare initial, or a truncated fragment — if the source text doesn't give a full name, skip that entry entirely rather than guessing or completing it.
- relationship: their role, e.g. "CEO", "Director", "10% Owner", if stated.
- transactionType: "Buy", "Sell", "Grant", or "Other" based on what's described.
- shares/value: only if a specific number is given in the source text.
- date: the filing or transaction date if mentioned.
- If you are not confident a specific named person is actually an insider of "${companyName}" (as opposed to some other company that happened to appear in the search results), omit them.
- Return an empty filings array if no source contains a specific, fully-named, clearly-attributed insider transaction — do not pad with generic or uncertain entries.`,
      combinedText,
      Form4ExtractionSchema
    );

    const filings: Form4Entry[] = (llmResult?.filings ?? []).filter((f) =>
      looksLikeFullPersonName(f.filerName)
    );

    return { filings, sources };
  }
}

/**
 * v2 upgrade path, not built here — replace search-and-synthesize with
 * real EDGAR data:
 *   1. GET https://www.sec.gov/files/company_tickers.json to resolve the
 *      company name/ticker to a CIK (free, no key, static file).
 *   2. GET https://data.sec.gov/submissions/CIK{10-digit-zero-padded}.json
 *      and filter filings.recent where form === "4", or use
 *      https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=...&type=4&owner=include
 *      for the issuer-indexed filing list.
 *   3. For each accession number, fetch the actual Form 4 XML
 *      (Archives/edgar/data/{cik}/{accession-no-dashes}/{primaryDocument})
 *      and parse nonDerivativeTable/derivativeTable transactions for the
 *      real filerName/transactionType/shares/value — this is the part
 *      that needs real XML schema handling and live testing to get right.
 */
