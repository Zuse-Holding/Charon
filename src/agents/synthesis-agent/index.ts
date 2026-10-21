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
 * Locked fact set (round 2, Fix 3): the model sees only the facts the
 * report already states about this business, numbered, and no new
 * searches run here. Each item must cite the facts it rests on; an item
 * citing none is dropped, and each cited fact's source gets a
 * "risks"/"opportunities" usedFor tag so those sections show real
 * citations instead of "Unverified". The consistency pass then drops any
 * item that drifts from those facts (see lib/consistency.ts).
 *
 * If the LLM isn't available, this returns null and the report says so.
 */

export interface Fact {
  text: string;
  url?: string;
}

/** Every fact the report states about the business, in report order. */
export function lockedFacts(bundle: ResearchBundle): Fact[] {
  const c = bundle.company;
  const facts: Fact[] = [];
  const site = c.website;
  if (c.description) facts.push({ text: `What it does: ${c.description}`, url: site });
  if (c.industry) facts.push({ text: `Industry: ${c.industry}`, url: site });
  if (c.headquarters) facts.push({ text: `Located in: ${c.headquarters}`, url: site });
  if (c.founded) facts.push({ text: `Founded: ${c.founded}`, url: site });
  if (c.closure) facts.push({ text: `Reported closed: ${c.closure.evidence}`, url: c.closure.url });
  for (const l of bundle.leadership) facts.push({ text: `Leadership: ${l.name}, ${l.title}`, url: l.sourceUrl });
  for (const p of bundle.products) facts.push({ text: `Offers: ${p.name}${p.description ? ` (${p.description})` : ""}`, url: p.sourceUrl });
  for (const x of bundle.competitors) facts.push({ text: `Competitor: ${x.name}`, url: x.url });
  if (bundle.funding.length === 0) facts.push({ text: "Funding: no public funding records found" });
  const fundingSource = bundle.sources.find((s) => s.usedFor.includes("funding"))?.url;
  for (const f of bundle.funding) {
    facts.push({ text: `Funding: ${[f.round, f.amount, f.date, f.investors?.join(", ")].filter(Boolean).join(", ")}`, url: fundingSource });
  }
  for (const n of bundle.news.slice(0, 5)) {
    facts.push({ text: `News${n.date ? ` (${n.date})` : ""}: ${n.headline}${n.summary ? `. ${n.summary}` : ""}`, url: n.url });
  }
  const spendingSource = bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url;
  for (const s of (bundle.federalSpending ?? []).slice(0, 5)) {
    facts.push({ text: `Federal award: ${[s.amount, s.awardingAgency, s.date].filter(Boolean).join(", ")}`, url: spendingSource });
  }
  return facts;
}

/**
 * Keeps items citing at least one valid fact, returning each with the
 * cited facts' source URLs, and tags the bundle's matching sources with
 * `tag`.
 */
export function resolveCitations(
  items: { text: string; sources: number[] }[],
  facts: Fact[],
  sources: Source[],
  tag: string
): { text: string; facts: number[]; urls: string[] }[] {
  const kept: { text: string; facts: number[]; urls: string[] }[] = [];
  for (const item of items) {
    const valid = [...new Set(item.sources.filter((n) => Number.isInteger(n) && n >= 1 && n <= facts.length))];
    if (valid.length === 0) continue;
    const urls = [...new Set(valid.map((n) => facts[n - 1].url).filter((u): u is string => !!u))];
    kept.push({ text: item.text, facts: valid, urls });
    for (const s of sources) {
      if (urls.includes(s.url) && !s.usedFor.includes(tag)) s.usedFor.push(tag);
    }
  }
  return kept;
}

export async function synthesizeRisksOpportunities(
  bundle: ResearchBundle
): Promise<{ risks: string[]; opportunities: string[]; citations: Record<string, string[]>; facts: Fact[] } | null> {
  const facts = lockedFacts(bundle);
  if (facts.length === 0) return null;
  const context = facts.map((f, i) => `[${i + 1}] ${f.text}`).join("\n");

  const result = await extractStructured(
    `You are a senior business analyst writing a Risks and Opportunities assessment for "${bundle.company.name}".

You get a numbered list of FACTS. They are everything known about this business. Use nothing else.

RULES — these are non-negotiable:
- Every risk and opportunity must rest on one or more of the numbered facts. Return each item as {"text": "<one sentence>", "sources": [<fact numbers>]}. An item you can't tie to a fact does not go in.
- Never name a company, product, person, place, technology or figure that isn't in the facts. Never bring in anything you know about other companies with a similar name.
- If the facts say there are no funding records, never mention funding, investors, rounds or valuations.
- NEVER use generic filler phrases: "well-positioned", "significant opportunity", "faces challenges", "rapidly evolving landscape", "capitalize on trends", "leverage synergies", "disruptive innovation".
- If the facts are thin, return 1-3 specific items, or none. Fewer specific items beat generic ones.
- Each item: one direct sentence, no hedging, no "may" or "could" or "potentially" unless the uncertainty is itself the point.
- If the facts can't support a credible assessment, return empty arrays.`,
    context,
    RisksOpportunitiesSchema
  );

  if (!result) return null;

  const risks = resolveCitations(result.risks ?? [], facts, bundle.sources, "risks");
  const opportunities = resolveCitations(result.opportunities ?? [], facts, bundle.sources, "opportunities");
  return {
    risks: risks.map((r) => r.text),
    opportunities: opportunities.map((o) => o.text),
    citations: Object.fromEntries([...risks, ...opportunities].map((i) => [i.text, i.urls])),
    facts,
  };
}
