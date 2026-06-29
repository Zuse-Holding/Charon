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
    `You are a business analyst writing a brief Risks and Opportunities assessment for "${bundle.company.name}" based on the research data provided. Be specific and grounded in the actual data given — do not invent facts not present in the data. If there isn't enough data to support a real risk or opportunity, return fewer items rather than padding with generic statements. 3-5 items each, one sentence per item.`,
    context,
    RisksOpportunitiesSchema
  );

  if (!result) return null;

  return {
    risks: (result.risks ?? []) as string[],
    opportunities: (result.opportunities ?? []) as string[],
  };
}
