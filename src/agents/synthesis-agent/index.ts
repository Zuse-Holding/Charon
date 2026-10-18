import { ResearchBundle, Source } from "../../types/research.js";
import { extractStructured, RisksOpportunitiesSchema } from "../../lib/llm.js";

/**
 * Risks & Opportunities synthesis.
 *
 * Unlike every other agent, this has NO heuristic fallback — it's pure
 * synthesis (reasoning across the whole gathered bundle: funding stage,
 * competitive landscape, recent news, leadership) rather than
 * extraction (finding a fact that's already stated in source text).
 * Regex/NLP have nothing to pattern-match against here, because the
 * conclusion doesn't appear verbatim anywhere in the source text — it's
 * the LLM connecting facts the way an analyst would.
 *
 * The model sees the sources behind its inputs as a numbered list and
 * must cite them per item. Items that cite nothing valid are dropped, and
 * each cited source gets a "risks"/"opportunities" usedFor tag so those
 * sections show real citations instead of "Unverified".
 *
 * If Ollama isn't available, this returns null and the report falls
 * back to its existing "not yet implemented" placeholder — which is
 * honest, since there genuinely is no implementation without an LLM.
 */

// The sections synthesis reads from; their sources are what it may cite.
const INPUT_TAGS = ["overview", "funding", "competitors", "news", "leadership"];
const MAX_CITABLE = 30;

export function citableSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources
    .filter((s) => {
      if (!s.usedFor.some((u) => INPUT_TAGS.includes(u)) || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .slice(0, MAX_CITABLE);
}

/**
 * Keeps items with at least one valid citation and tags each cited source
 * (pool entries are the bundle's own Source objects) with `tag`.
 */
export function resolveCitations(items: { text: string; sources: number[] }[], pool: Source[], tag: string): string[] {
  const texts: string[] = [];
  for (const item of items) {
    const valid = item.sources.filter((n) => Number.isInteger(n) && n >= 1 && n <= pool.length);
    if (valid.length === 0) continue;
    texts.push(item.text);
    for (const n of valid) {
      const s = pool[n - 1];
      if (!s.usedFor.includes(tag)) s.usedFor.push(tag);
    }
  }
  return texts;
}

export async function synthesizeRisksOpportunities(
  bundle: ResearchBundle
): Promise<{ risks: string[]; opportunities: string[] } | null> {
  const pool = citableSources(bundle.sources);
  const context = JSON.stringify(
    {
      company: bundle.company,
      funding: bundle.funding,
      competitors: bundle.competitors,
      recentNews: bundle.news.slice(0, 5),
      leadership: bundle.leadership,
      sources: pool.map((s, i) => ({ id: i + 1, title: s.title ?? s.publisher, url: s.url })),
    },
    null,
    2
  );

  const result = await extractStructured(
    `You are a senior business analyst writing a Risks and Opportunities assessment for "${bundle.company.name}".

RULES — these are non-negotiable:
- Every risk and opportunity must be grounded in specific data from the provided research. Reference actual facts: funding stage, named competitors, specific news items, leadership details.
- Return each item as an object: {"text": "<one sentence>", "sources": [<ids>]}, where ids are numbers from the provided "sources" list that the item rests on. An item you can't tie to at least one listed source does not go in.
- NEVER use generic filler phrases: "well-positioned", "significant opportunity", "faces challenges", "rapidly evolving landscape", "capitalize on trends", "leverage synergies", "disruptive innovation". These add no value.
- If the data is thin, return 2-3 specific items rather than padding with 5 generic ones. Fewer specific insights beat more generic ones every time.
- Risks should identify a real, specific downside — regulatory, competitive, financial, operational. Name the actual risk, not a category.
- Opportunities should identify a specific, actionable upside tied to the company's actual position.
- Each item: one direct sentence, no hedging, no "may" or "could" or "potentially" unless the uncertainty is itself the point.
- If there is genuinely insufficient data to write a credible assessment, return an empty array rather than inventing risks or opportunities.`,
    context,
    RisksOpportunitiesSchema
  );

  if (!result) return null;

  return {
    risks: resolveCitations(result.risks ?? [], pool, "risks"),
    opportunities: resolveCitations(result.opportunities ?? [], pool, "opportunities"),
  };
}
