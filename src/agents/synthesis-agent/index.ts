import { ResearchBundle, Source } from "../../types/research.js";
import { extractAnalysis, RisksOpportunitiesSchema } from "../../lib/llm.js";
import { money } from "../report-agent/index.js";
import type { CaseRecord } from "../public-filings-agent/index.js";
import { STATES } from "../competitor-agent/index.js";
import { insiderSelling } from "../../lib/insiders.js";

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
  /** When it happened, for facts that are events (awards, rounds, cases, news). */
  when?: string;
  /** What kind of record it is: past awards and rounds are history (launch fix 45). */
  kind?: "award" | "funding" | "case" | "news" | "trend";
  /** The case behind a case fact, to check sentences against (launch fix 46). */
  caseRef?: CaseRecord;
}

/**
 * Cases filed in the same court on the same day, against the company: one
 * related claim, not separate risks (launch fix 46: Blyden, Sims and Guay v.
 * Graybar, all E.D. Mo. on one day).
 */
export function caseClusters(cases: CaseRecord[]): { text: string; cases: CaseRecord[] }[] {
  const groups = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (c.routine || !c.filed || !c.court) continue;
    const key = `${c.court}|${c.filed}|${c.role ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => {
    const names = g.map((c) => c.caption.split(/\s+v(?:s)?\.?\s+/i)[c.role === "defendant" ? 0 : 1] ?? c.caption).map((n) => n.trim());
    const type = g.every((c) => c.caseType && c.caseType === g[0].caseType) ? ` ${g[0].caseType}` : "";
    const side = g[0].role === "defendant" ? " against the company" : g[0].role === "plaintiff" ? " brought by the company" : "";
    return { text: `${g.length}${type} suits${side} (${names.join(", ")}) filed in ${g[0].court} on the same day, ${g[0].filed}: likely one related claim`, cases: g };
  });
}

/** First and last year of a series, as a trend line (launch fix 46). */
export function trendLine(label: string, series: { year: string; value?: number }[]): string | undefined {
  const known = series.filter((p) => p.value !== undefined).sort((a, b) => a.year.localeCompare(b.year));
  if (known.length < 2) return undefined;
  const [a, b] = [known[0], known[known.length - 1]];
  const pct = Math.round(((b.value! - a.value!) / Math.abs(a.value!)) * 100);
  if (!Number.isFinite(pct) || Math.abs(pct) < 5) return `${label} flat at about ${money(b.value!)} (${a.year}-${b.year})`;
  return `${label} ${pct > 0 ? "rose" : "fell"} ${Math.abs(pct)}% from ${money(a.value!)} (${a.year}) to ${money(b.value!)} (${b.year})`;
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
  for (const a of bundle.corporateActions ?? []) facts.push({ text: `${a.kind === "Acquisition" ? "Acquired" : "Subsidiary or brand"}: ${a.name}${a.date ? ` (${a.date})` : ""}`, url: a.url, when: a.date, kind: "news" });
  const type = c.entityType;
  if (bundle.funding.length === 0 && type !== "nonprofit" && type !== "public") facts.push({ text: "Funding: no public funding records found" });
  if (bundle.ownership) facts.push({ text: `Ownership: ${bundle.ownership}`, url: bundle.sources.find((x) => x.usedFor.includes("funding"))?.url });
  if (type === "nonprofit") facts.push({ text: "Organization: a nonprofit; it has no investors or funding rounds" });
  const np = bundle.nonprofitFinancials;
  for (const y of np?.years ?? []) {
    const parts = [y.revenue !== undefined && `revenue ${money(y.revenue)}`, y.contributions !== undefined && `contributions and grants ${money(y.contributions)}`,
      y.expenses !== undefined && `expenses ${money(y.expenses)}`, y.assets !== undefined && `assets ${money(y.assets)}`].filter(Boolean);
    if (parts.length) facts.push({ text: `Form 990 (${y.year}): ${parts.join(", ")}`, url: np!.url });
  }
  // Trends across the 990 years, which the model otherwise reads as a list.
  if (np && np.years.length >= 2) {
    const series = (pick: (y: NonNullable<typeof np>["years"][number]) => number | undefined) => np.years.map((y) => ({ year: y.year, value: pick(y) }));
    const lines = [trendLine("Expenses", series((y) => y.expenses)), trendLine("Contributions and grants", series((y) => y.contributions)),
      trendLine("Revenue", series((y) => y.revenue))].filter(Boolean);
    if (lines.length) facts.push({ text: `990 trend: ${lines.join("; ")}`, url: np.url, kind: "trend" });
  }
  const fundingSource = bundle.sources.find((s) => s.usedFor.includes("funding"))?.url;
  for (const f of bundle.funding) {
    // Each Form D cites its own filing (round 16: a 2019 filing's risk linked the 2025 one).
    facts.push({ text: `Funding: ${[f.round, f.amount, f.date, f.investors?.join(", ")].filter(Boolean).join(", ")}`, url: f.url ?? fundingSource, when: f.date, kind: "funding" });
  }
  // A plaintiff firm's "investigation" release is routine after a share-
  // price drop and never a risk on its own (launch fix 46).
  for (const n of bundle.news.filter((x) => !x.solicitation).slice(0, 5)) {
    facts.push({ text: `News${n.date ? ` (${n.date})` : ""}: ${n.headline}${n.summary ? `. ${n.summary}` : ""}`, url: n.url, when: n.date, kind: "news" });
  }
  // Cases arrive ranked (cases against the company, open, newest first);
  // routine bankruptcy matters aren't risks (launch fix 21).
  // Suits the company brought are never risks (launch fix 58: MJW's top
  // risk was its own suit against SentryWest; Patagonia's its trademark
  // suit against Patagonia Candles). They're summed up once instead, as
  // what the company enforces (launch fix 68: ~40 trademark suits).
  const cases = bundle.courtCases ?? [];
  const brought = cases.filter((c) => c.role === "plaintiff");
  if (brought.length >= 3) {
    const ip = brought.filter((c) => /trademark|patent|copyright|lanham|intellectual/i.test(`${c.caseType ?? ""} ${c.caption}`)).length;
    facts.push({ text: `Suits it brought (not risks): ${brought.length} as plaintiff${ip ? `, ${ip} over trademarks, patents or copyrights` : ""}`, url: brought[0].url, kind: "trend" });
  }
  const against = cases.filter((c) => !c.routine && c.role !== "plaintiff");
  // Related suits read as one pattern, ahead of the cases themselves.
  for (const cl of caseClusters(against)) facts.push({ text: `Case pattern: ${cl.text}`, url: cl.cases[0].url, when: cl.cases[0].filed, kind: "case" });
  for (const c of against.slice(0, 6)) {
    const side = c.role === "defendant" ? "company is the defendant" : c.role === "plaintiff" ? "company is the plaintiff"
      : c.role === "charged" ? "charge against the company" : c.role === "debtor" ? "company is the debtor" : "";
    const ctx = [c.court && `${c.court}${c.docketNumber ? ` ${c.docketNumber}` : ""}`, c.filed && `filed ${c.filed}`, side, c.caseType, c.status].filter(Boolean).join(", ");
    facts.push({ text: `Case: ${c.caption}${ctx ? ` (${ctx})` : ""}`, url: c.url, when: c.filed, kind: "case", caseRef: c });
  }
  // Large or repeated insider selling (launch fix 83).
  const insiderUrl = bundle.sources.find((s) => s.usedFor.includes("insider-activity"))?.url;
  for (const s of insiderSelling(bundle.insiderActivity ?? [])) facts.push({ text: s.text, url: s.url ?? insiderUrl, when: s.when });
  const spendingUrl = bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url;
  for (const c of bundle.contractCeilings ?? []) {
    facts.push({ text: `Federal contract: ${c.agency} ceiling ${money(c.ceiling)} announced${c.newsDate ? ` (${c.newsDate})` : ""}; about ${money(c.obligated)} obligated to date`, url: spendingUrl ?? c.newsUrl });
  }
  const fdd = bundle.fdd;
  if (fdd) {
    // Every FDD figure, not just three (launch fix 68).
    const parts = [fdd.franchisorRevenue && `franchisor revenue ${fdd.franchisorRevenue}`, fdd.franchisorNetIncome && `franchisor net income ${fdd.franchisorNetIncome}`,
      fdd.averageUnitSales && `average store sales ${fdd.averageUnitSales}`, fdd.unitCount && `${fdd.unitCount} stores`,
      fdd.franchiseFee && `franchise fee ${fdd.franchiseFee}`, fdd.royalty && `royalty ${fdd.royalty}`, fdd.initialInvestment && `initial investment ${fdd.initialInvestment}`].filter(Boolean);
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
    if (sec.financials.length >= 2) {
      const rev = trendLine("Revenue", sec.financials.map((y) => ({ year: y.year, value: y.revenue })));
      const gm = sec.financials.filter((y) => y.grossMargin !== undefined).sort((a, b) => a.year.localeCompare(b.year));
      const margin = gm.length >= 2 ? `gross margin ${(gm[0].grossMargin! * 100).toFixed(1)}% (FY${gm[0].year}) to ${(gm[gm.length - 1].grossMargin! * 100).toFixed(1)}% (FY${gm[gm.length - 1].year})` : undefined;
      const lines = [rev, margin].filter(Boolean);
      if (lines.length) facts.push({ text: `SEC trend: ${lines.join("; ")}`, url: fin, kind: "trend" });
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
    facts.push({ text: `Federal award (past): ${[s.amount, s.awardingAgency, s.date].filter(Boolean).join(", ")}`, url: spendingSource, when: s.date, kind: "award" });
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
  tag: string,
  keep: (text: string, cited: number[]) => boolean = () => true
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
    if (urls.length === 0 || !keep(item.text, valid)) continue;
    kept.push({ text: item.text, facts: valid, urls });
    for (const s of sources) {
      if (urls.includes(s.url) && !s.usedFor.includes(tag)) s.usedFor.push(tag);
    }
  }
  return kept;
}

const YEAR_MS = 365 * 86_400_000;
const parsedWhen = (w?: string) => {
  const t = w ? Date.parse(/^\d{4}$/.test(w) ? `${w}-12-31` : w) : NaN;
  return isNaN(t) ? undefined : t;
};

/**
 * An opportunity resting only on things that already happened more than
 * a year ago (launch fix 45: ACCO and Graybar listed federal awards back
 * to 2013; Homeboy called a 2025 grant "scheduled") is history.
 */
export function isHistoryOnly(cited: number[], facts: Fact[], now = Date.now()): boolean {
  const fs = cited.map((n) => facts[n - 1]).filter(Boolean);
  // News over a year old counts too (Graybar's 2021 acquisitions).
  return fs.length > 0 && fs.every((f) => {
    const t = parsedWhen(f.when);
    if (f.kind === "news") return t !== undefined && t < now - YEAR_MS;
    return (f.kind === "award" || f.kind === "funding" || f.kind === "case") && (t ?? 0) < now - YEAR_MS;
  });
}

/** The same set of fact numbers. */
export function sameFacts(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n) => b.includes(n));
}

/**
 * An opportunity resting only on competitors is theirs, not this
 * company's (launch fix 77: Promise ABA's only opportunity was a review
 * of Autism Spectrum Therapies).
 */
export function aboutOthersOnly(cited: number[], facts: Fact[]): boolean {
  const fs = cited.map((n) => facts[n - 1]).filter(Boolean);
  return fs.length > 0 && fs.every((f) => f.text.startsWith("Competitor:"));
}

/**
 * A sentence the case records it cites contradict (launch fix 46: Crumbl's
 * risk said it "filed multiple lawsuits as a defendant" and that all cases
 * were open; several were closed).
 */
export function contradictsCases(text: string, cited: number[], facts: Fact[]): boolean {
  const cases = cited.map((n) => facts[n - 1]?.caseRef).filter((c): c is CaseRecord => !!c);
  if (!cases.length) return false;
  const t = text.toLowerCase();
  const filedBy = /\b(filed|brought|initiated)\b[^.]{0,30}\b(law)?suits?\b|\bas (a |the )?plaintiff\b/.test(t);
  const against = /\bas (a |the )?defendant\b|\b(sued|faces?|facing)\b[^.]{0,20}\b(law)?suits?\b|\bagainst (it|the company)\b/.test(t);
  if (filedBy && /\bas (a |the )?defendant\b/.test(t)) return true;
  if (/\b(all|every)\b[^.]{0,30}\b(open|pending|ongoing)\b/.test(t) && cases.some((c) => c.status === "closed")) return true;
  if (/\b(open|pending|ongoing|active)\b/.test(t) && cases.every((c) => c.status === "closed")) return true;
  if (against && cases.every((c) => c.role === "plaintiff")) return true;
  if (filedBy && cases.every((c) => c.role === "defendant" || c.role === "charged")) return true;
  return false;
}

const DETAIL_WORDS = /\b(civil rights|discrimination|harassment|retaliation|wrongful termination|personal injury|wrongful death|product liability|breach of contract|fraud|antitrust|patent|trademark|copyright|erisa|wage|overtime|class action|securities|environmental|asbestos|qui tam|whistleblower)\b/gi;
const MONTH_YEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/gi;
const NOT_NAMES = new Set(["the", "its", "it", "a", "an", "this", "that", "these", "their", "company", "inc", "llc", "ceo", "cfo", "coo",
  "president", "founder", "board", "risk", "federal", "state", "court", "case", "suit", "lawsuit", "news", "sec", "nlrb", "u.s", "us",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

const DISTRICT: Record<string, string> = { N: "Northern", S: "Southern", E: "Eastern", W: "Western", C: "Central", M: "Middle" };

/**
 * The facts with their abbreviations spelled out too, so a sentence that
 * writes them out isn't read as adding a detail (launch fix 78: "Western
 * District of Washington" for "W.D. Washington" dropped ACCO's real risk).
 */
export function spelledOut(text: string): string {
  const extra: string[] = [];
  for (const m of text.matchAll(/\b([NSEWCM])\.\s?D\./g)) extra.push(`${DISTRICT[m[1]]} District`);
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) if (STATES[m[1]]) extra.push(STATES[m[1]]);
  if (/\bCir\./.test(text)) extra.push("Circuit");
  return extra.length ? `${text} ${extra.join(" ")}` : text;
}

/**
 * A detail in the sentence that none of its cited facts state (launch fix
 * 59: ACCO's risk called a union benefit-trust suit "civil rights" and
 * cited a California case that doesn't exist). Case types, month-and-year
 * dates, and capitalized names other than the company's must each appear
 * in what the item cites.
 */
export function unsupportedDetail(text: string, cited: number[], facts: Fact[], companyName: string): string | undefined {
  const source = spelledOut(cited.map((n) => facts[n - 1]?.text ?? "").join(" ")).toLowerCase();
  const company = companyName.toLowerCase();
  for (const m of text.matchAll(DETAIL_WORDS)) if (!source.includes(m[0].toLowerCase())) return m[0];
  for (const m of text.matchAll(MONTH_YEAR)) {
    if (!source.includes(m[2]) || !source.includes(m[1].toLowerCase().slice(0, 3))) return m[0];
  }
  const words = text.match(/[A-Za-z][A-Za-z.'’&-]*/g) ?? [];
  for (const w of words.slice(1)) {
    const bare = w.replace(/['’]s$/, "").replace(/[.'’-]+$/, "");
    if (!/^[A-Z]/.test(bare) || NOT_NAMES.has(bare.toLowerCase()) || company.includes(bare.toLowerCase())) continue;
    if (!source.includes(bare.toLowerCase())) return bare;
  }
  return undefined;
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

"summary" is an executive summary of 3-5 sentences on what the facts show: what the business does, where, for whom, at what scale (revenue, locations, people), and the two or three things that stand out most. Write it in your own words. Never copy or lightly reword the "What it does" fact or any marketing tagline.

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
- A Form D that sold less than it offered is routine, never a risk: the offered amount is a ceiling the company registers, not a target it missed.
- An opportunity is ahead of the business: an expansion under way, a contract vehicle with room left under its ceiling, a new market, a campaign in progress. A past federal award, grant or round is history, never an opportunity, and never call a past grant "scheduled".
- Connect facts instead of listing them: related cases filed together are one risk; a "Case pattern" or "trend" fact beats several single facts. Say what changed and by how much.
- State case status and the company's side exactly as the facts give them. A suit the company brought is never a risk.
- Never add a detail the cited facts don't state: no case type, court, state, date or dollar figure that isn't in them. If a fact leaves a field out, leave it out too.
- Leadership facts are current. Never build a risk on titles, turnover or a "dispute" the facts don't state.
- For a nonprofit, risks and opportunities are about its programs, revenue mix, grants, campaigns, cases and leadership, never investors.
- An "Insider selling" fact is a risk: name who sold, how much and when, exactly as the fact states.
- Never turn an opportunity around into a risk: a new fund, product or location is not a risk because it is new. If no fact shows a real risk, return an empty "risks" array.
- If the facts can't support a credible assessment, return empty arrays.`,
    context,
    RisksOpportunitiesSchema
  );

  if (!result) return null;
  const checkRisk = (text: string, cited: number[]) => {
    const extra = unsupportedDetail(text, cited, facts, bundle.company.name);
    if (extra) console.log(`[synthesis] dropped an item for "${extra}", which its facts don't state: ${text.slice(0, 120)}`);
    return !extra && !contradictsCases(text, cited, facts);
  };

  let risks = resolveCitations((result.risks ?? []).filter((r) => !isGenericRisk(r.text)), facts, bundle.sources, "risks", checkRisk);
  // No risk survived from a rich fact set (launch fix 35: Homeboy's summary
  // worked, its Risks said "insufficient data"): ask once more for risks
  // alone, each tied to fact numbers.
  if (risks.length === 0 && facts.filter((f) => f.url).length >= 6) {
    const again = await extractAnalysis(
      `You list the main risks for "${bundle.company.name}" from a numbered list of FACTS, using nothing else.
Answer with ONE JSON object: {"risks": [{"text": "<one sentence naming a specific fact: a case, figure, date, filing, location or person>", "sources": [<fact numbers>]}]}
Most current and serious first: open cases against it, declines in its figures, recent closures or layoffs, concentration on one funder, customer or contract. Never a risk any organization has. 1-4 items, or none if the facts show none.`,
      context, RisksOpportunitiesSchema);
    risks = resolveCitations((again?.risks ?? []).filter((r) => !isGenericRisk(r.text)), facts, bundle.sources, "risks", checkRisk);
    console.log(`[synthesis] "${bundle.company.name}": risks-only retry gave ${again?.risks?.length ?? 0}, ${risks.length} kept with citations`);
  }
  console.log(`[synthesis] "${bundle.company.name}": model gave ${result.risks?.length ?? 0} risk(s), ${result.opportunities?.length ?? 0} opportunit(ies); ${risks.length} risk(s) kept with citations`);
  // The summary ships only when it cites a sourced fact and isn't the
  // site's own description again; otherwise the report keeps the extracted one.
  const summary = result.summary
    ? resolveCitations([result.summary], facts, bundle.sources, "overview")[0]
    : undefined;
  const opportunities = resolveCitations(result.opportunities ?? [], facts, bundle.sources, "opportunities",
    (text, cited) => !isHistoryOnly(cited, facts) && !aboutOthersOnly(cited, facts) && checkRisk(text, cited));
  // A risk resting on exactly the facts an opportunity rests on is the same
  // item turned around (launch fix 78: MJW's "first fund only debuted in June").
  const before = risks.length;
  risks = risks.filter((r) => !opportunities.some((o) => sameFacts(r.facts, o.facts)));
  if (risks.length < before) console.log(`[synthesis] "${bundle.company.name}": dropped ${before - risks.length} risk(s) that restate an opportunity`);
  return {
    summary: summary && !copiesDescription(summary.text, bundle.company.description) ? summary.text : undefined,
    risks: risks.map((r) => r.text),
    opportunities: opportunities.map((o) => o.text),
    citations: Object.fromEntries([...risks, ...opportunities].map((i) => [i.text, i.urls])),
    facts,
  };
}
