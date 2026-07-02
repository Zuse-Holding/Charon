import { ResearchBundle } from "../../types/research.js";
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
 * If Ollama isn't available, this returns null and the report falls
 * back to its existing "not yet implemented" placeholder — which is
 * honest, since there genuinely is no implementation without an LLM.
 */
export async function synthesizeRisksOpportunities(
  bundle: ResearchBundle
): Promise<{ risks: string[]; opportunities: string[] } | null> {
  const context = JSON.stringify(
    {
      company: bundle.company,
      funding: bundle.funding,
      competitors: bundle.competitors,
      recentNews: bundle.news.slice(0, 5),
      leadership: bundle.leadership,
    },
    null,
    2
  );

  const result = await extractStructured(
    `You are a senior business analyst writing a Risks and Opportunities assessment for "${bundle.company.name}".

RULES — these are non-negotiable:
- Every risk and opportunity must be grounded in specific data from the provided research. Reference actual facts: funding stage, named competitors, specific news items, leadership details.
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
    risks: (result.risks ?? []) as string[],
    opportunities: (result.opportunities ?? []) as string[],
  };
}
