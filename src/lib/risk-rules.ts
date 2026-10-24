import type { NewsEntry, ResearchBundle } from "../types/research.js";
import type { CaseRecord } from "../agents/public-filings-agent/index.js";
import { GENERIC_SEC_DOC, insiderSelling } from "./insiders.js";
import { mentionsCompany } from "./news-noise.js";
import { namedAsBusiness } from "./gap-fill.js";

/** The caption names the company as a party: a multi-word name, or a one-word name used as a business. */
function namesCompanyAsParty(caption: string, name: string): boolean {
  if (!mentionsCompany(caption, name)) return false;
  const core = name.replace(/,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/i, "").trim();
  return core.split(/\s+/).length >= 2 || namedAsBusiness(caption, name) || /\b(v\.|versus)\s/i.test(caption);
}

/**
 * Rule-based risk signals (round 10). The model kept dropping real risks
 * between runs (Homeboy's 78% expense jump, Gecko's Navy concentration,
 * Limbach's CFO selling) and adding filler. These rules read the data the
 * report already holds and state the signal directly, with its source; the
 * model's risks come first, and a rule adds its line only when no model
 * risk already covers the same record.
 */

export interface RuleRisk { text: string; urls: string[]; key: string }

const YEAR_MS = 365 * 86_400_000;
const CLOSURE = /\b(clos(e|es|ed|ing|ures?)|shutter(s|ed|ing)?|shuts? down|layoffs?|lays? off|laid off|bankrupt\w*|chapter 11|recall(s|ed)?|default(s|ed)?|delist\w*)\b/i;

const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const pct = (a: number, b: number) => Math.round(((b - a) / Math.abs(a)) * 100);
const recent = (date: string | undefined, now: number, years = 1) => {
  const t = date ? Date.parse(date) : NaN;
  return !isNaN(t) && t >= now - years * YEAR_MS;
};

export function ruleRisks(bundle: ResearchBundle, names: string[], now = Date.now()): RuleRisk[] {
  const out: RuleRisk[] = [];
  const insiderUrl = bundle.sources.find((s) => s.usedFor.includes("insider-activity") && !GENERIC_SEC_DOC.test(s.url))?.url;

  // 1. Insider selling, with the dollar total worked out from the filings.
  for (const s of insiderSelling(bundle.insiderActivity ?? [])) {
    if (s.text.startsWith("Insider selling by ")) continue;
    const url = s.url ?? insiderUrl;
    out.push({ text: `${s.text.replace(/^Insider selling: /, "")}.`, urls: url ? [url] : [], key: "insider" });
  }

  // 2. Nonprofit: expenses growing while revenue or contributions fall.
  const np = bundle.nonprofitFinancials;
  if (np && np.years.length >= 2) {
    const ys = [...np.years].sort((a, b) => a.year.localeCompare(b.year));
    const [a, b] = [ys[0], ys[ys.length - 1]];
    if (a.expenses && b.expenses && pct(a.expenses, b.expenses) >= 20) {
      const rev = a.revenue && b.revenue ? pct(a.revenue, b.revenue) : undefined;
      const con = a.contributions && b.contributions ? pct(a.contributions, b.contributions) : undefined;
      if ((rev !== undefined && rev < 0) || (con !== undefined && con < 0)) {
        const parts = [con !== undefined && con < 0 && `contributions and grants fell ${-con}% (${money(a.contributions!)} to ${money(b.contributions!)})`,
          rev !== undefined && rev < 0 && `total revenue fell ${-rev}%`].filter(Boolean).join(" and ");
        out.push({ text: `Expenses rose ${pct(a.expenses, b.expenses)}% from ${money(a.expenses)} (${a.year}) to ${money(b.expenses)} (${b.year}) while ${parts}.`, urls: [np.url], key: "990" });
      }
    }
  }

  // 3. Public company: revenue decline or margin compression in its filings.
  const fin = bundle.secFilings?.financials ?? [];
  if (fin.length >= 2) {
    const ys = [...fin].sort((a, b) => a.year.localeCompare(b.year));
    const [a, b] = [ys[ys.length - 2], ys[ys.length - 1]];
    const url = bundle.sources.find((s) => s.url.includes("companyfacts"))?.url ?? bundle.secFilings?.tenKUrl;
    if (a.revenue && b.revenue && pct(a.revenue, b.revenue) <= -5) {
      out.push({ text: `Revenue fell ${-pct(a.revenue, b.revenue)}% from ${money(a.revenue)} (FY${a.year}) to ${money(b.revenue)} (FY${b.year}).`, urls: url ? [url] : [], key: "sec-revenue" });
    }
    if (a.grossMargin !== undefined && b.grossMargin !== undefined && b.grossMargin - a.grossMargin <= -0.01) {
      out.push({ text: `Gross margin fell from ${(a.grossMargin * 100).toFixed(1)}% (FY${a.year}) to ${(b.grossMargin * 100).toFixed(1)}% (FY${b.year}).`, urls: url ? [url] : [], key: "sec-margin" });
    }
  }

  // 4. Closures, layoffs, bankruptcy or recalls in the last year's news.
  const closing = bundle.news.filter((n: NewsEntry) => n.url && !n.solicitation && recent(n.date, now)
    && CLOSURE.test(n.headline) && names.some((nm) => mentionsCompany(`${n.headline}. ${n.summary ?? ""}`, nm)));
  if (closing.length) {
    const n = closing[0];
    out.push({ text: `Recent coverage reports ${n.headline.replace(/[.\s]+$/, "")}${n.date ? ` (${n.outlet ? `${n.outlet}, ` : ""}${n.date})` : ""}.`, urls: closing.slice(0, 2).map((x) => x.url!), key: "closure" });
  }

  // 5. Open suits against it filed in the last three years.
  const open = (bundle.courtCases ?? []).filter((c: CaseRecord) => !c.routine && (c.role === "defendant" || c.role === "charged")
    && c.status !== "closed" && c.status !== "status unverified" && recent(c.filed, now, 3) && c.url);
  if (open.length >= 2) {
    const top = open[0];
    out.push({ text: `${open.length} open federal cases against the company were filed since ${open.map((c) => c.filed!).sort()[0].slice(0, 4)}, most recently ${top.caption} (${[top.court, top.filed].filter(Boolean).join(", ")}).`, urls: open.slice(0, 3).map((c) => c.url), key: "open-cases" });
  } else if (open.length === 1) {
    const c = open[0];
    out.push({ text: `Open case against the company: ${c.caption} (${[c.court, c.filed, c.caseType].filter(Boolean).join(", ")}).`, urls: [c.url], key: "open-cases" });
  }

  // 6. A government enforcement action on record.
  // Only an action that names the company as itself, from the last ten
  // years (round 11: a 2013 DOJ release on drug traffickers in the town of
  // Patagonia, Arizona, became a Patagonia risk).
  const charged = (bundle.courtCases ?? []).filter((c) => c.role === "charged" && c.caseType === "Government enforcement" && c.url
    && recent(c.filed, now, 10) && names.some((nm) => namesCompanyAsParty(c.caption, nm)));
  for (const c of charged.slice(0, 1)) {
    out.push({ text: `Government enforcement action on record: ${c.caption}${c.court ? ` (${c.court}${c.filed ? `, ${c.filed}` : ""})` : ""}.`, urls: [c.url], key: "enforcement" });
  }

  // 7. Dependence on one federal buyer: a contract ceiling far above what's been obligated.
  for (const k of (bundle.contractCeilings ?? []).filter((k) => k.ceiling >= 50_000_000).slice(0, 1)) {
    const url = bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url ?? k.newsUrl;
    out.push({ text: `Growth leans on one federal buyer: ${k.agency}'s ${money(k.ceiling)} ceiling has about ${money(k.obligated)} obligated so far, so most of that value depends on future task orders.`, urls: url ? [url] : [], key: "concentration" });
  }
  return out.filter((r) => r.urls.length);
}

/**
 * Model risks first; each rule risk is added unless a model risk already
 * cites one of its records or names its key detail. At most `cap` risks.
 */
export function mergeRuleRisks(risks: string[], citations: Record<string, string[]>, rules: RuleRisk[], cap = 6): { risks: string[]; citations: Record<string, string[]> } {
  const out = [...risks];
  const cites = { ...citations };
  const citedUrls = new Set(risks.flatMap((r) => cites[r] ?? []));
  const said = risks.join(" ").toLowerCase();
  const covered = (r: RuleRisk) => r.urls.some((u) => citedUrls.has(u))
    || (r.key === "insider" && /\binsider|\bsold\b/.test(said) && said.includes(r.text.split(/\s+/)[1]?.toLowerCase() ?? "~"))
    || (r.key === "990" && /\bexpenses?\b/.test(said))
    || (r.key === "closure" && CLOSURE.test(said));
  for (const r of rules) {
    if (out.length >= cap) break;
    if (covered(r)) continue;
    out.push(r.text);
    cites[r.text] = r.urls;
    for (const u of r.urls) citedUrls.add(u);
  }
  return { risks: out, citations: cites };
}

// Personal-life coverage of a founder is not a business risk (launch fix 49).
const TABLOID = /\b(grindr|tiktok(er| star)?|dating|outed|affair|divorce|girlfriend|boyfriend|wedding|celebrity|influencer feud|instagram post)\b/i;
// A discount is marketing, never a risk.
const SALE = /\b(\d+\s?% off|below retail|on sale|(rare |big |deep )?savings|selling (its|the)[^.]*\b(off|discount)|discount(ed|s)?|deals?|price cuts?)\b/i;

export function isTabloidRisk(text: string): boolean {
  return TABLOID.test(text);
}

/** A risk that's really a product sale or discount (Patagonia, round 10). */
export function isSaleRisk(text: string): boolean {
  return SALE.test(text);
}

// Opportunities that only restate what it offers, praise it, or note an
// event with no business consequence (round 10: Promise, ACCO, Andersen).
const FILLER_OPPORTUNITY = /\b(engag\w* (with )?the community|annual (5k|gala|event|fundraiser|walk|run)|brings? thousands together|comprehensive offerings?|broad (market )?reach|diverse (service )?(capabilities|offerings)|cater to a broad|by offering both|expand its reach by offering|community (engagement|relations)|brand visibility|positive (public )?feedback|indicates? (ongoing )?leadership development|strategic planning within|demonstrates? (ongoing )?(commitment|engagement)|(\d+\s?%|significant(ly)?)\s?(off|discount)|below retail|discount(ed|s)?\b)/i;

export function isFillerOpportunity(text: string): boolean {
  return FILLER_OPPORTUNITY.test(text);
}

/** An opportunity about a place or event that shares the name, not the company (Patagonia region trips). */
export function aboutNamesake(text: string, names: string[]): boolean {
  return /\b(region|trips?|tours?|hiking|travel|trek|glaciers?|data centers?)\b/i.test(text)
    && names.some((n) => new RegExp(`\\b(to|in|across|around|of)\\s+${n.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

// A risk names something adverse. "The acquisition of Coventry Square is the
// most recent property acquisition mentioned" (MJW, round 11) names nothing.
const ADVERSE = /\b(defendant|lawsuit|suit|case|charge[ds]?|enforcement|violation|penalt|fine[ds]?|settle|investigat|fell|falls?|fall(ing)?|declin|drop|los(s|ses|t|ing)|sold|selling|clos(e|ed|es|ing|ure)|shutter|layoff|bankrupt|default|debt|lien|recall|depend|concentrat|relian|reliance|lean(s)? on|exposure|risk|uncertain|delay|dispute|turnover|resign|depart|exit|down|weak|slow|pressure|squeeze|shortfall|deficit|negative|warn|cut|terminat|lapse|expir|unverified|outdated|no longer|failed|fail)\w*/i;

export function isNonRisk(text: string): boolean {
  return !ADVERSE.test(text);
}

/**
 * Rule-based opportunities (round 12). Gecko's report said "insufficient
 * data" while it held a $300M Navy ceiling with a few million obligated and
 * a new plant announced. These read what the report already holds.
 */
export interface RuleOpportunity { text: string; urls: string[]; key: string }

const EXPANSION = /\b(to open|opens?|opening|new (facility|plant|factory|office|headquarters|campus|location|market)|expan(ds?|sion|ding)|launch(es|ed)?|enters?|breaks ground|groundbreaking)\b/i;
// A dollar campaign or plan in the headline ("plans $100-million ...").
const CAMPAIGN = /\b(capital campaign|campaign|fundrais\w*|plans?|launch(es)?|aims? to raise|to raise)\b/i;

export function ruleOpportunities(bundle: ResearchBundle, names: string[], now = Date.now()): RuleOpportunity[] {
  const out: RuleOpportunity[] = [];
  const about = (n: NewsEntry) => names.some((nm) => mentionsCompany(`${n.headline}. ${n.summary ?? ""}`, nm));
  const when = (n: NewsEntry) => (n.date ? ` (${n.outlet ? `${n.outlet}, ` : ""}${n.date})` : "");

  // 1. Room left under a large contract ceiling.
  for (const k of (bundle.contractCeilings ?? []).filter((k) => k.ceiling >= 10_000_000 && k.ceiling > k.obligated * 3).slice(0, 1)) {
    const url = k.newsUrl ?? bundle.sources.find((s) => s.usedFor.includes("federal-spending"))?.url;
    out.push({ text: `${k.agency} contract announced at ${money(k.ceiling)} against about ${money(k.obligated)} obligated so far, leaving most of the ceiling open for future task orders.`, urls: url ? [url] : [], key: "ceiling" });
  }

  // 2. An expansion announced in the last year.
  const grow = bundle.news.filter((n) => n.url && !n.solicitation && recent(n.date, now) && EXPANSION.test(n.headline) && !CLOSURE.test(n.headline) && about(n));
  if (grow.length) {
    const n = grow[0];
    out.push({ text: `Expansion under way: ${n.headline.replace(/[.\s]+$/, "")}${when(n)}.`, urls: [n.url!], key: "expansion" });
  }

  // 3. A fund or campaign being raised now.
  const target = bundle.funding.find((f) => /\(target\)$/.test(f.round ?? "") && f.amount);
  const targetUrl = bundle.sources.find((s) => s.usedFor.includes("funding"))?.url;
  if (target && targetUrl) out.push({ text: `Raising ${target.round!.replace(/\s*\(target\)$/, "")} toward a ${target.amount} target.`, urls: [targetUrl], key: "fund" });
  const campaign = bundle.company.entityType === "nonprofit" || /\bcampaign\b/i.test(bundle.news.map((n) => n.headline).join(" "))
    ? bundle.news.find((n) => n.url && recent(n.date, now, 2) && CAMPAIGN.test(n.headline) && /\$\d/.test(n.headline) && !CLOSURE.test(n.headline) && about(n))
    : undefined;
  if (campaign) out.push({ text: `Campaign in progress: ${campaign.headline.replace(/\s*(\.\.\.|…)\s*$/, "").replace(/[.\s]+$/, "")}${when(campaign)}.`, urls: [campaign.url!], key: "campaign" });

  return out.filter((r) => r.urls.length);
}

/** Model opportunities first; a rule adds its line unless one already cites its record. At most `cap`. */
export function mergeRuleOpportunities(opps: string[], citations: Record<string, string[]>, rules: RuleOpportunity[], cap = 5): { opportunities: string[]; citations: Record<string, string[]> } {
  const out = [...opps];
  const cites = { ...citations };
  const citedUrls = new Set(opps.flatMap((o) => cites[o] ?? []));
  const said = opps.join(" ").toLowerCase();
  for (const r of rules) {
    if (out.length >= cap) break;
    if (r.urls.some((u) => citedUrls.has(u)) || (r.key === "ceiling" && /\bceiling\b/.test(said))) continue;
    out.push(r.text);
    cites[r.text] = r.urls;
    for (const u of r.urls) citedUrls.add(u);
  }
  return { opportunities: out, citations: cites };
}
