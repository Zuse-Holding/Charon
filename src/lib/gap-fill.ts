import { z } from "zod";
import type { CompetitorEntry, FundingEntry, LeadershipEntry, ResearchBundle, Source } from "../types/research.js";
import type { SearchProvider, SearchResult } from "./providers.js";
import { extractAnalysis } from "./llm.js";
import { mentionsCompany } from "./news-noise.js";
import { isPersonName, samePerson, seniority } from "./leadership.js";
import { strongNameMatch } from "./name-match.js";

/**
 * Gap-fill pass (round 10, "fill the gaps"): ChatGPT wins on the basics
 * because it searches, sees what's missing and searches again; Metis
 * searched once. After the bundle is assembled, this looks at what's still
 * empty (founded, headquarters, a top executive, peers, funding for a
 * venture-backed company, acquisitions), runs one or two targeted searches
 * per gap, and reads the results with one model call.
 *
 * Nothing the model says ships on its own word: every value must be found,
 * as written, in the search result it cites, and that result must name the
 * company (or come from its own domain). Values only fill empty fields; they
 * never replace a sourced one.
 */

export type Gap = "basics" | "executives" | "competitors" | "funding" | "acquisitions";

export interface GapSnippet { n: number; title: string; url: string; text: string; date?: string }

export interface GapFillResult {
  filled: string[];
  /** Search results that name the company and say it acquired something,
   *  for the corporate-actions pass. */
  actionTexts: { text: string; url: string; date?: string }[];
}

const MIN_COMPETITORS = 4;
const MAX_COMPETITORS = 8;
const MAX_SNIPPETS = 40;

const VENTURE_OWNER = /\b(trust|collective|foundation|non-?profit|employee-owned|ESOP|family[- ]owned)\b/i;

/** What's still missing from the bundle, in the order it matters to a buyer. */
export function findGaps(bundle: ResearchBundle, domain?: string, now = Date.now()): Gap[] {
  const c = bundle.company;
  const gaps: Gap[] = [];
  if (!c.founded || !c.headquarters) gaps.push("basics");
  if (!hasCurrentChief(bundle.leadership, domain, now)) gaps.push("executives");
  if (bundle.competitors.length < MIN_COMPETITORS) gaps.push("competitors");
  if (needsFunding(bundle)) gaps.push("funding");
  if (!(bundle.corporateActions?.length)) gaps.push("acquisitions");
  return gaps;
}

const CHIEF = /\b(ceo|chief executive|co-ceo|president|executive director|managing partner)\b/i;
const NOT_CHIEF = /\bvice[- ]president\b|\bvp\b/i;

/**
 * Someone holds the top seat by title (CEO, president, executive director),
 * on the company's own site or a source from the last three years (round 10:
 * Graybar's only "President" was a 2012 article; Gecko listed two
 * "Cofounders" and no CEO).
 */
export function hasCurrentChief(leadership: LeadershipEntry[], domain: string | undefined, now = Date.now()): boolean {
  return leadership.some((l) => {
    if (l.lowConfidence || !CHIEF.test(l.title) || NOT_CHIEF.test(l.title)) return false;
    let own = false;
    try { own = !!domain && !!l.sourceUrl && new URL(l.sourceUrl).hostname.replace(/^www\./, "").endsWith(domain); } catch { /* not a URL */ }
    const t = l.asOf ? Date.parse(l.asOf) : NaN;
    return own || (!isNaN(t) && t >= now - 3 * 365 * 86_400_000) || (!l.asOf && !l.sourceUrl);
  });
}

/** A company that might have venture rounds and shows none. */
export function needsFunding(bundle: ResearchBundle, now = Date.now()): boolean {
  const c = bundle.company;
  // Rounds on record, but none dated in the last three years: look for the
  // later ones (round 11: Gecko showed only its 2020 Series B, not C or D).
  const recentRound = bundle.funding.some((f) => {
    const y = Number(f.date?.match(/\b(19|20)\d{2}\b/)?.[0]);
    return !!y && y >= new Date(now).getFullYear() - 3;
  });
  if (recentRound) return false;
  if (c.entityType === "nonprofit" || c.entityType === "public" || bundle.secFilings || c.stockListing || bundle.nonprofitFinancials) return false;
  if (bundle.ownership && VENTURE_OWNER.test(bundle.ownership)) return false;
  const year = Number(c.founded?.match(/\b(1[6-9]|20)\d{2}\b/)?.[0]);
  // A business founded before 2000 isn't raising seed and Series rounds.
  return !year || year >= 2000;
}

/** Targeted queries for each gap. */
export function gapQueries(name: string, gaps: Gap[]): { gap: Gap; query: string }[] {
  const q = `"${name}"`;
  const out: { gap: Gap; query: string }[] = [];
  for (const g of gaps) {
    if (g === "basics") out.push({ gap: g, query: `${q} founded headquarters` });
    if (g === "executives") out.push({ gap: g, query: `${q} CEO` }, { gap: g, query: `${q} president chief executive officer` });
    if (g === "competitors") out.push({ gap: g, query: `${q} competitors` }, { gap: g, query: `${q} vs alternatives` });
    if (g === "funding") out.push({ gap: g, query: `${q} raises funding round Series` });
    if (g === "acquisitions") out.push({ gap: g, query: `${q} acquires acquisition` });
  }
  return out;
}

/** A result is about this company: it names it, or it's on its own site. */
export function aboutCompany(r: { title: string; snippet?: string; url: string }, names: string[], domain?: string): boolean {
  if (domain) {
    try { if (new URL(r.url).hostname.replace(/^www\./, "").endsWith(domain)) return true; } catch { /* not a URL */ }
  }
  const text = `${r.title}. ${r.snippet ?? ""}`;
  return names.some((n) => mentionsCompany(text, n) && (multiWord(n) || namedAsBusiness(text, n, domain)));
}

const SUFFIX_RE = /,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/i;
const core = (n: string) => n.replace(SUFFIX_RE, "").trim();
const multiWord = (n: string) => core(n).split(/\s+/).length >= 2;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A one-word name is also a place, a word or another company's name (the
 * town of Patagonia, Arizona). The text must treat it as this business: its
 * domain, a legal suffix, a possessive, or a business word right beside it.
 */
export function namedAsBusiness(text: string, name: string, domain?: string): boolean {
  const c = esc(core(name));
  if (domain && text.toLowerCase().includes(domain.toLowerCase())) return true;
  if (new RegExp(`\\b(town|city|county|region|province|valley|lake|river|mount|of)\\s+${c}\\b`, "i").test(text)) return false;
  return new RegExp(`\\b${c}(,?\\s+(inc|llc|corp|co)\\b|['’]s\\b|\\s+(ceo|founder|president|chairman|company|brand|raises|acquires|announces|competitors|headquarter\\w*|employees|stores?|reported|said)\\b)|\\b(ceo|founder|president) of ${c}\\b`, "i").test(text);
}

const GapSchema = z.record(z.string(), z.unknown()).transform((o) => {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : undefined);
  const field = (v: unknown) => {
    if (!v || typeof v !== "object") return undefined;
    const r = v as Record<string, unknown>;
    const value = str(r.value);
    const source = num(r.source);
    return value && source ? { value, source } : undefined;
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  return {
    founded: field(o.founded),
    headquarters: field(o.headquarters),
    executives: list(o.executives).map((r) => ({ name: str(r.name), title: str(r.title), source: num(r.source) })),
    competitors: list(o.competitors).map((r) => ({ name: str(r.name), source: num(r.source) })),
    funding: list(o.funding).map((r) => ({ round: str(r.round), amount: str(r.amount), date: str(r.date), source: num(r.source) })),
  };
});
export type GapExtraction = z.infer<typeof GapSchema>;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$.\s]/g, " ").replace(/\s+/g, " ");

/** The snippet states this value, as written (year, city, name or figure). */
export function snippetStates(snippet: string, value: string, kind: "year" | "place" | "name" | "money"): boolean {
  const s = norm(snippet);
  if (kind === "year") {
    const y = value.match(/\b(1[6-9]|20)\d{2}\b/)?.[0];
    return !!y && s.includes(y);
  }
  if (kind === "money") {
    const digits = value.match(/\d+(?:\.\d+)?/)?.[0];
    return !!digits && s.includes(digits);
  }
  if (kind === "place") {
    const city = norm(value.split(",")[0]).trim();
    return city.length >= 3 && s.includes(city);
  }
  // Every distinctive word of the name (surname at least) is in the text.
  const words = norm(value).split(" ").filter((w) => w.length >= 3 && !/^(inc|llc|corp|the|and|company|co)$/.test(w));
  return words.length > 0 && words.every((w) => s.includes(w));
}

/**
 * Merges what the model read into the bundle's empty fields, keeping only
 * values its cited snippet states. Pure, for tests.
 */
export function mergeGaps(bundle: ResearchBundle, x: GapExtraction, snippets: GapSnippet[], gaps: Gap[], names: string[]): string[] {
  const filled: string[] = [];
  const snip = (n?: number) => snippets.find((s) => s.n === n);
  const cite = (s: GapSnippet, usedFor: string) => {
    const src = bundle.sources.find((x) => x.url === s.url);
    if (src) { if (!src.usedFor.includes(usedFor)) src.usedFor.push(usedFor); }
    else bundle.sources.push({ url: s.url, title: s.title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] } as Source);
  };
  const c = bundle.company;
  if (gaps.includes("basics")) {
    const f = x.founded, s = snip(f?.source);
    const year = f?.value.match(/\b(1[6-9]|20)\d{2}\b/)?.[0];
    if (!c.founded && year && s && snippetStates(s.text, year, "year") && Number(year) <= new Date().getFullYear()) {
      c.founded = year; c.foundedSource = s.url; cite(s, "overview"); filled.push(`founded ${year}`);
    }
    const h = x.headquarters, hs = snip(h?.source);
    if (!c.headquarters && h && hs && snippetStates(hs.text, h.value, "place")) {
      c.headquarters = h.value; cite(hs, "overview"); filled.push(`headquarters ${h.value}`);
    }
  }
  if (gaps.includes("executives")) {
    for (const e of x.executives) {
      const s = snip(e.source);
      if (!e.name || !e.title || !s || !isPersonName(e.name) || !snippetStates(s.text, e.name, "name")) continue;
      // Only the top seats; a name the snippet doesn't tie to a senior title is skipped.
      if (seniority(e.title) > 1 || !/\b(ceo|chief|president|chair|founder|owner|executive director|managing partner)\b/i.test(s.text)) continue;
      const known = bundle.leadership.find((l) => samePerson(l.name, e.name!));
      if (known) {
        // A cofounder the site lists without the top title gets it (Gecko).
        if (CHIEF.test(e.title) && !NOT_CHIEF.test(e.title) && !CHIEF.test(known.title)) {
          known.title = `${e.title}${known.title ? ` and ${known.title}` : ""}`;
          known.sourceUrl = s.url; known.asOf = s.date ?? known.asOf;
          cite(s, "leadership"); filled.push(`${e.name} is ${e.title}`);
        } else if (CHIEF.test(e.title) && norm(e.title).includes(norm(known.title).trim()) && e.title.length > known.title.length) {
          // A fuller current title ("Chairman, President and CEO" for "President").
          known.title = e.title; known.sourceUrl = s.url; known.asOf = s.date ?? known.asOf;
          cite(s, "leadership"); filled.push(`${e.name} is ${e.title}`);
        }
        continue;
      }
      bundle.leadership.push({ name: e.name, title: e.title, sourceUrl: s.url, asOf: s.date } as LeadershipEntry);
      cite(s, "leadership"); filled.push(`${e.title} ${e.name}`);
      if (bundle.leadership.filter((l) => seniority(l.title) <= 1).length >= 4) break;
    }
  }
  if (gaps.includes("competitors")) {
    for (const k of x.competitors) {
      if (bundle.competitors.length >= MAX_COMPETITORS) break;
      const s = snip(k.source);
      if (!k.name || !s || !snippetStates(s.text, k.name, "name")) continue;
      if (names.some((n) => strongNameMatch(k.name!, n) || k.name!.toLowerCase().includes(n.toLowerCase()))) continue;
      if (bundle.competitors.some((y) => y.name.toLowerCase() === k.name!.toLowerCase() || strongNameMatch(y.name, k.name!))) continue;
      bundle.competitors.push({ name: k.name, url: s.url } as CompetitorEntry);
      cite(s, "competitors"); filled.push(`competitor ${k.name}`);
    }
  }
  if (gaps.includes("funding")) {
    for (const f of x.funding) {
      const s = snip(f.source);
      if (!f.round || !f.amount || !s || !snippetStates(s.text, f.amount, "money")) continue;
      if (bundle.funding.some((g) => (g.round ?? "").toLowerCase() === f.round!.toLowerCase())) continue;
      // The snippet must say this company raised it, not a namesake or an investor.
      if (!names.some((n) => mentionsCompany(s.text, n)) || !/\b(rais\w*|secur\w*|closes?|funding|round|series|seed)\b/i.test(s.text)) continue;
      bundle.funding.push({ round: f.round, amount: f.amount, date: f.date } as FundingEntry);
      cite(s, "funding"); filled.push(`${f.round} ${f.amount}`);
    }
  }
  return filled;
}

/**
 * Runs the gap-fill pass. Never throws: a failed search or model call
 * leaves the bundle as it was.
 */
export async function fillGaps(bundle: ResearchBundle, searcher: SearchProvider, names: string[], domain?: string): Promise<GapFillResult> {
  const gaps = findGaps(bundle, domain);
  const result: GapFillResult = { filled: [], actionTexts: [] };
  if (!gaps.length || bundle.company.thin) return result;
  const primary = names[0];
  const queries = gapQueries(primary, gaps);
  try {
    const batches = await Promise.all(queries.map((q) => searcher.search(q.query, 8).catch(() => [] as SearchResult[])));
    const seen = new Set<string>();
    const snippets: GapSnippet[] = [];
    for (const r of batches.flat()) {
      if (!r.url || seen.has(r.url) || !aboutCompany(r, names, domain)) continue;
      seen.add(r.url);
      snippets.push({ n: snippets.length + 1, title: r.title, url: r.url, text: `${r.title}. ${r.snippet ?? ""}`, date: r.date });
      if (snippets.length >= MAX_SNIPPETS) break;
    }
    if (gaps.includes("acquisitions")) {
      result.actionTexts = snippets.filter((s) => /\b(acquir\w*|buys|bought|acquisition)\b/i.test(s.text)).map((s) => ({ text: s.text, url: s.url, date: s.date }));
    }
    const wanted = gaps.filter((g) => g !== "acquisitions");
    // One line per run, filled or not, so the logs show the pass ran.
    console.log(`[gap-fill] "${primary}": gaps ${gaps.join(", ")}; ${batches.flat().length} results, ${snippets.length} about the company`);
    if (!snippets.length || !wanted.length) return result;
    const context = snippets.map((s) => `[${s.n}] ${s.text} (${s.url})`).join("\n");
    const ask = [
      wanted.includes("basics") && `"founded": {"value": "<year>", "source": <n>} and "headquarters": {"value": "<City, ST>", "source": <n>} for ${primary} itself`,
      wanted.includes("executives") && `"executives": [{"name": "...", "title": "...", "source": <n>}] — current CEO, president, chair, founders and chief officers of ${primary} only`,
      wanted.includes("competitors") && `"competitors": [{"name": "...", "source": <n>}] — companies the results name as ${primary}'s competitors or alternatives (not its customers, partners, investors or parent)`,
      wanted.includes("funding") && `"funding": [{"round": "Series B", "amount": "$40M", "date": "2021", "source": <n>}] — rounds ${primary} itself raised`,
    ].filter(Boolean).join("\n");
    const x = await extractAnalysis(
      `You read numbered search results about "${primary}" and pull out specific facts. Answer with ONE JSON object with these keys:
${ask}

RULES:
- Use only the numbered results. Every value cites the ONE result number that states it, word for word.
- Facts about other companies with a similar name, or about a parent, subsidiary or investor, are not ${primary}'s. Leave them out.
- Leave out anything the results don't state. An empty list or a missing key is fine.`,
      context, GapSchema);
    if (!x) { console.log(`[gap-fill] "${primary}": model returned nothing usable`); return result; }
    result.filled = mergeGaps(bundle, x, snippets, wanted, names);
    console.log(`[gap-fill] "${primary}": ${result.filled.length ? `filled ${result.filled.join("; ")}` : "nothing passed the source checks"}`);
  } catch (err) {
    console.error("[gap-fill] skipped:", err instanceof Error ? err.message : err);
  }
  return result;
}
