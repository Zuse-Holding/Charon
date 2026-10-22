import { ResearchBundle, Source } from "../../types/research.js";
import { extractAnalysis, RisksOpportunitiesSchema } from "../../lib/llm.js";
import { money } from "../report-agent/index.js";

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
  // Only current, well-sourced titles (launch fix 35): a title a newer
  // source gives someone else, or a name only a people directory lists,
  // never becomes a risk ("two CEOs" at Limbach was one former CEO).
  for (const l of bundle.leadership) {
    if (l.lowConfidence) continue;
    facts.push({ text: `Leadership: ${l.name}, ${l.title}`, url: l.sourceUrl });
  }
  for (const p of bundle.products) facts.push({ text: `Offers: ${p.name}${p.description ? ` (${p.description})` : ""}`, url: p.sourceUrl });
  for (const x of bundle.competitors) facts.push({ text: `Competitor: ${x.name}`, url: x.url });
  const type = c.entityType;
  if (bundle.funding.length === 0 && type !== "nonprofit" && type !== "public") facts.push({ text: "Funding: no public funding records found" });
  if (type === "nonprofit") facts.push({ text: "Organization: a nonprofit; it has no investors or funding rounds" });
  const np = bundle.nonprofitFinancials;
  for (const y of np?.years ?? []) {
    const parts = [y.revenue !== undefined && `revenue ${money(y.revenue)}`, y.contributions !== undefined && `contributions and grants ${money(y.contributions)}`,
      y.expenses !== undefined && `expenses ${money(y.expenses)}`, y.assets !== undefined && `assets ${money(y.assets)}`].filter(Boolean);
    if (parts.length) facts.push({ text: `Form 990 (${y.year}): ${parts.join(", ")}`, url: np!.url });
  }
  const fundingSource = bundle.sources.find((s) => s.usedFor.includes("funding"))?.url;
  for (const f of bundle.funding) {
    facts.push({ text: `Funding: ${[f.round, f.amount, f.date, f.investors?.join(", ")].filter(Boolean).join(", ")}`, url: fundingSource });
  }
  for (const n of bundle.news.slice(0, 5)) {
    facts.push({ text: `News${n.date ? ` (${n.date})` : ""}: ${n.headline}${n.summary ? `. ${n.summary}` : ""}`, url: n.url });
  }
  // Cases arrive ranked (cases against the company, open, newest first);
  // routine bankruptcy matters aren't risks (launch fix 21).
  for (const c of (bundle.courtCases ?? []).filter((x) => !x.routine).slice(0, 5)) {
    const side = c.role === "defendant" ? "company is the defendant" : c.role === "plaintiff" ? "company is the plaintiff"
      : c.role === "charged" ? "charge against the company" : c.role === "debtor" ? "company is the debtor" : "";
    const ctx = [c.court && `${c.court}${c.docketNumber ? ` ${c.docketNumber}` : ""}`, c.filed && `filed ${c.filed}`, side, c.caseType, c.status].filter(Boolean).join(", ");
    facts.push({ text: `Case: ${c.caption}${ctx ? ` (${ctx})` : ""}`, url: c.url });
  }
  const spendingUrl = bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url;
  for (const c of bundle.contractCeilings ?? []) {
    facts.push({ text: `Federal contract: ${c.agency} ceiling ${money(c.ceiling)} announced${c.newsDate ? ` (${c.newsDate})` : ""}; about ${money(c.obligated)} obligated to date`, url: spendingUrl ?? c.newsUrl });
  }
  const fdd = bundle.fdd;
  if (fdd) {
    const parts = [fdd.franchisorRevenue && `franchisor revenue ${fdd.franchisorRevenue}`, fdd.averageUnitSales && `average store sales ${fdd.averageUnitSales}`,
      fdd.unitCount && `${fdd.unitCount} stores`].filter(Boolean);
    if (parts.length) facts.push({ text: `Franchise disclosure${fdd.year ? ` (${fdd.year})` : ""}: ${parts.join(", ")}`, url: fdd.urls[0] });
  }
  const sec = bundle.secFilings;
  if (sec) {
    const fin = bundle.sources.find((s) => s.url.includes("companyfacts"))?.url ?? sec.tenKUrl;
    for (const y of sec.financials) {
      const parts = [y.revenue !== undefined && `revenue ${money(y.revenue)}`, y.netIncome !== undefined && `net income ${money(y.netIncome)}`,
        y.grossMargin !== undefined && `gross margin ${(y.grossMargin * 100).toFixed(1)}%`].filter(Boolean);
      if (parts.length) facts.push({ text: `Financials FY${y.year} (SEC): ${parts.join(", ")}`, url: fin });
    }
    const q = sec.latestQuarter;
    if (q && q.revenue !== undefined) {
      const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
      const parts = [`revenue ${money(q.revenue)}${q.priorRevenue !== undefined ? ` vs ${money(q.priorRevenue)} a year earlier` : ""}`,
        q.grossMargin !== undefined && `gross margin ${pct(q.grossMargin)}${q.priorGrossMargin !== undefined ? ` vs ${pct(q.priorGrossMargin)} a year earlier` : ""}`].filter(Boolean);
      facts.push({ text: `Financials ${q.label} (SEC): ${parts.join(", ")}`, url: fin });
    }
    if (sec.earnings) {
      const e = sec.earnings;
      if (e.highlights.length) facts.push({ text: `Earnings release (${e.period ?? e.date}): ${e.highlights.join("; ")}`, url: e.url });
      if (e.guidance) facts.push({ text: `Guidance (${e.date}): ${e.guidance}`, url: e.url });
    }
    if (sec.legalProceedings) facts.push({ text: `Legal proceedings (10-K): ${sec.legalProceedings}`, url: sec.tenKUrl });
    for (const r of sec.riskFactors.slice(0, 5)) facts.push({ text: `Risk factor (10-K): ${r}`, url: sec.tenKUrl });
    if (sec.board?.independence) facts.push({ text: `Board (proxy): ${sec.board.independence}`, url: sec.proxyUrl });
  }
  for (const l of c.locations ?? []) facts.push({ text: `Location: ${l}`, url: site });
  const spendingSource = bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url;
  for (const s of (bundle.federalSpending ?? []).slice(0, 5)) {
    facts.push({ text: `Federal award: ${[s.amount, s.awardingAgency, s.date].filter(Boolean).join(", ")}`, url: spendingSource });
  }
  return facts;
}

/**
 * Keeps items citing at least one valid fact with a source page, returning each with the
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
    let valid = [...new Set(item.sources.filter((n) => Number.isInteger(n) && n >= 1 && n <= facts.length))];
    // A model that returns bare sentences cites nothing (launch fix 28:
    // Gecko and Crumbl got "insufficient data" from rich findings). The
    // facts an item plainly restates are its citations; one that restates
    // none still doesn't ship.
    if (valid.length === 0 && item.sources.length === 0) valid = factsRestated(item.text, facts);
    if (valid.length === 0) continue;
    const urls = [...new Set(valid.map((n) => facts[n - 1].url).filter((u): u is string => !!u))];
    // Resting only on facts with no page behind them ("no public funding
    // records found") leaves nothing to cite: the item doesn't ship.
    if (urls.length === 0) continue;
    kept.push({ text: item.text, facts: valid, urls });
    for (const s of sources) {
      if (urls.includes(s.url) && !s.usedFor.includes(tag)) s.usedFor.push(tag);
    }
  }
  return kept;
}

// Risks any company "faces" (launch fix 4): ACCO's and MJW's top risk was
// competing with bigger names. A risk has to be about this business.
const GENERIC_RISK = /\b(faces?|facing) (direct |stiff |intense |significant )?competition\b|\bcompet\w* (with|against) (larger|bigger|established|well[- ]funded|major|national)\b|\b(larger|bigger|established|well[- ]funded) (competitors|rivals|players)\b|\b(economic|market) (downturns?|conditions|volatility)\b|\bregulatory changes\b/i;

export function isGenericRisk(text: string): boolean {
  return GENERIC_RISK.test(text);
}

/** Lowercased words, for comparing a summary with the site's own copy. */
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * The summary repeats the site's description: it shares a run of six or
 * more words with it (Promise ABA's summary was its tagline, typo and all).
 */
export function copiesDescription(summary: string, description: string | undefined): boolean {
  if (!description) return false;
  const d = words(description);
  const runs = new Set<string>();
  for (let i = 0; i + 6 <= d.length; i++) runs.add(d.slice(i, i + 6).join(" "));
  const sw = words(summary);
  for (let i = 0; i + 6 <= sw.length; i++) if (runs.has(sw.slice(i, i + 6).join(" "))) return true;
  return false;
}

const STOP = new Set(["that", "this", "with", "from", "into", "their", "there", "which", "while", "about", "could", "would",
  "should", "have", "has", "been", "were", "will", "than", "more", "most", "less", "also", "its", "company", "business"]);
const contentWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9$.%\s]/g, " ").split(/\s+/)
  .filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOP.has(w)));

/** Facts (1-based) sharing at least two content words with the item, best first, at most two. */
export function factsRestated(text: string, facts: Fact[]): number[] {
  const words = contentWords(text);
  return facts
    .map((f, i) => ({ n: i + 1, hits: [...contentWords(f.text.replace(/^[^:]{1,30}:/, ""))].filter((w) => words.has(w)).length }))
    .filter((x) => x.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map((x) => x.n);
}

export async function synthesizeRisksOpportunities(
  bundle: ResearchBundle
): Promise<{ summary?: string; risks: string[]; opportunities: string[]; citations: Record<string, string[]>; facts: Fact[] } | null> {
  const facts = lockedFacts(bundle);
  if (facts.length === 0) return null;
  const context = facts.map((f, i) => `[${i + 1}] ${f.text}`).join("\n");

  const result = await extractAnalysis(
    `You are a senior business analyst writing a Risks and Opportunities assessment for "${bundle.company.name}".

You get a numbered list of FACTS. They are everything known about this business. Use nothing else.

Answer with ONE JSON object, exactly this shape:
{"summary": {"text": "...", "sources": [1, 2]}, "risks": [{"text": "...", "sources": [3]}], "opportunities": [{"text": "...", "sources": [4]}]}

"summary" is an executive summary of what the facts show: what the business does, where, for whom, at what scale, and what stands out. Write it in your own words. Never copy or lightly reword the "What it does" fact or any marketing tagline.

RULES — these are non-negotiable:
- Every risk and opportunity must rest on one or more of the numbered facts. Return each item as {"text": "<one sentence>", "sources": [<fact numbers>]}. An item you can't tie to a fact does not go in.
- Never name a company, product, person, place, technology or figure that isn't in the facts. Never bring in anything you know about other companies with a similar name.
- If the facts say there are no funding records, never mention funding, investors, rounds or valuations.
- NEVER use generic filler phrases: "well-positioned", "significant opportunity", "faces challenges", "rapidly evolving landscape", "capitalize on trends", "leverage synergies", "disruptive innovation".
- If the facts are thin, return 1-3 specific items, or none. Fewer specific items beat generic ones.
- Each item: one direct sentence, no hedging, no "may" or "could" or "potentially" unless the uncertainty is itself the point.
- Order risks by how much they matter now: an open case against the company, a recent filing or financial decline first; a case the company brought, or an old closed one, last or not at all.
- Every risk must name something specific to this business from the facts: a location, a person, a contract, a filing, a figure, a date, a named competitor. Never a risk any company has ("faces competition from larger companies", "economic downturns", "regulatory changes").
- A funding round more than 18 months old is history, never a current opportunity.
- Leadership facts are current. Never build a risk on titles, turnover or a "dispute" the facts don't state.
- For a nonprofit, risks and opportunities are about its programs, revenue mix, grants, campaigns, cases and leadership, never investors.
- If the facts can't support a credible assessment, return empty arrays.`,
    context,
    RisksOpportunitiesSchema
  );

  if (!result) return null;

  let risks = resolveCitations((result.risks ?? []).filter((r) => !isGenericRisk(r.text)), facts, bundle.sources, "risks");
  // No risk survived from a rich fact set (launch fix 35: Homeboy's summary
  // worked, its Risks said "insufficient data"): ask once more for risks
  // alone, each tied to fact numbers.
  if (risks.length === 0 && facts.filter((f) => f.url).length >= 6) {
    const again = await extractAnalysis(
      `You list the main risks for "${bundle.company.name}" from a numbered list of FACTS, using nothing else.
Answer with ONE JSON object: {"risks": [{"text": "<one sentence naming a specific fact: a case, figure, date, filing, location or person>", "sources": [<fact numbers>]}]}
Most current and serious first: open cases against it, declines in its figures, recent closures or layoffs, concentration on one funder, customer or contract. Never a risk any organization has. 1-4 items, or none if the facts show none.`,
      context, RisksOpportunitiesSchema);
    risks = resolveCitations((again?.risks ?? []).filter((r) => !isGenericRisk(r.text)), facts, bundle.sources, "risks");
    console.log(`[synthesis] "${bundle.company.name}": risks-only retry gave ${again?.risks?.length ?? 0}, ${risks.length} kept with citations`);
  }
  console.log(`[synthesis] "${bundle.company.name}": model gave ${result.risks?.length ?? 0} risk(s), ${result.opportunities?.length ?? 0} opportunit(ies); ${risks.length} risk(s) kept with citations`);
  // The summary ships only when it cites a sourced fact and isn't the
  // site's own description again; otherwise the report keeps the extracted one.
  const summary = result.summary
    ? resolveCitations([result.summary], facts, bundle.sources, "overview")[0]
    : undefined;
  const opportunities = resolveCitations(result.opportunities ?? [], facts, bundle.sources, "opportunities");
  return {
    summary: summary && !copiesDescription(summary.text, bundle.company.description) ? summary.text : undefined,
    risks: risks.map((r) => r.text),
    opportunities: opportunities.map((o) => o.text),
    citations: Object.fromEntries([...risks, ...opportunities].map((i) => [i.text, i.urls])),
    facts,
  };
}
