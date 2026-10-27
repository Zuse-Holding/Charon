import type { NewsEntry, PersonResearchBundle } from "../types/research.js";
import type { SearchResult } from "./providers.js";
import { isLawFirmSolicitation, isPersonalLifeNews, isPlaceNamesake, isShoppingOrQuote, mentionsPerson, newsDate, outletFromUrl } from "./news-noise.js";
import { mentionsAffiliation } from "./entities/affiliation.js";
import { nameWords } from "./name-match.js";
import { splitSentences } from "./nlp.js";

/**
 * Person-search checks ported from the company rounds (round 20): a name
 * alone never confirms a record, no pasted snippet as a summary, dated
 * news newest first, and the current role from the newest dated story.
 */

/** Organizations this person is tied to: the typed affiliation, the current employer, past employers. */
export function personAnchors(bundle: Pick<PersonResearchBundle, "person" | "careerHistory">): string[] {
  const all = [bundle.person.affiliation, bundle.person.currentCompany, ...bundle.careerHistory.map((c) => c.company)];
  return [...new Set(all.map((a) => a?.trim()).filter((a): a is string => !!a))];
}

/** Every word of the organization's name is in the text ("Bank of America", not any bank). */
export function namesOrg(text: string, org: string): boolean {
  const want = nameWords(org);
  if (!want.length) return false;
  const have = new Set(nameWords(text));
  return want.every((w) => have.has(w));
}

/**
 * A record found by the person's name is theirs only when it also names
 * an organization they're tied to (round 18's rule for SEC filers: the
 * name alone never confirms). The typed affiliation also counts by
 * acronym ("UCLA").
 */
export function tiedToPerson(text: string, anchors: string[], affiliation?: string): boolean {
  return anchors.some((a) => namesOrg(text, a) || namesOrg(a, text))
    || (!!affiliation && mentionsAffiliation(text, affiliation));
}

/**
 * The fallback summary when extraction returned nothing: one whole
 * sentence that names this person, never a pasted snippet (round 19:
 * ACCO's summary quoted another company's 10-K).
 */
export function summaryFromSnippet(snippet: string | undefined, personName: string): string | undefined {
  if (!snippet) return undefined;
  return splitSentences(snippet)
    .map((s) => s.trim())
    .find((s) => s.length >= 40 && s.length <= 300 && /[.!?]$/.test(s) && !/\.\.\.|…/.test(s) && mentionsPerson(s, personName));
}

/**
 * Person news as the company path builds it: dated, with the outlet,
 * newest first (undated last), with no gossip, shopping, quote pages,
 * law-firm solicitations or the name used as a place.
 */
export function personNews(results: SearchResult[], personName: string, now = new Date()): NewsEntry[] {
  return results
    .filter((r) => !isPersonalLifeNews(r.title, r.snippet, r.url) && !isShoppingOrQuote(r.title, r.url))
    .filter((r) => !isLawFirmSolicitation(r.title, r.snippet) && !isPlaceNamesake(r.title, r.snippet, personName))
    .map((r, i) => ({ r, i, date: newsDate(r.date, r.url, now) }))
    .map((x) => ({ ...x, t: Date.parse(x.date ?? "") }))
    .sort((a, b) => (isNaN(b.t) ? -Infinity : b.t) - (isNaN(a.t) ? -Infinity : a.t) || a.i - b.i)
    .map(({ r, date }) => ({
      headline: r.title,
      ...(date ? { date } : {}),
      summary: r.snippet,
      url: r.url,
      outlet: outletFromUrl(r.url),
    }));
}

export type RoleChange =
  | { kind: "joined"; role: string; company: string; date: string; headline: string }
  | { kind: "left"; role?: string; company?: string; date: string; headline: string };

// Title-case headlines and sentence-case snippets both: "Named"/"named".
const either = (w: string) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`;
const verbs = (ws: string[]) => `(?:${ws.map((w) => w.split(" ").map(either).join("\\s+")).join("|")})`;
const ROLE = "((?:[A-Z][\\w&/.-]*)(?:\\s+(?:and\\s+|&\\s+)?[A-Z][\\w&/.-]*){0,5}?)";
// Nothing follows the title in "joins Globex as Chief Revenue Officer": take every word.
const ROLE_TO_END = ROLE.replace("{0,5}?", "{0,5}");
const ORG = "([A-Z][\\w&'.-]*(?:\\s+(?:[A-Z0-9][\\w&'.-]*|&))*)";
const JOINED = verbs(["named", "appointed", "promoted to", "tapped as", "elected", "hired as", "becomes", "takes over as"]);
const JOINS = verbs(["joins"]);
// "to step down" and "will retire" haven't happened yet.
const LEFT = `(?<!\\b(?:to|will|[Ww]ill)\\s)${verbs(["steps down", "stepped down", "resigns", "resigned", "retires", "retired", "departs", "departed", "leaves", "left"])}`;
const MAX_AGE_MS = 2 * 365 * 86_400_000;

/**
 * The newest dated story, from the last two years, that this person took
 * or left a role (round 18's headquarters rule: a dated relocation story
 * beats undated pages). Bio pages carry no dates, so a dated appointment
 * or departure is the newest word on where they work.
 */
export function roleFromNews(news: NewsEntry[], personName: string, now = new Date()): RoleChange | undefined {
  const parts = personName.trim().split(/\s+/);
  const last = parts[parts.length - 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!last) return undefined;
  const who = `\\b${last}\\b[^.]{0,80}?\\b`;
  const joined = new RegExp(`${who}${JOINED}\\s+(?:as\\s+)?(?:the\\s+|its\\s+)?(?:new\\s+)?${ROLE}\\s+(?:of|at)\\s+${ORG}`);
  const joins = new RegExp(`${who}${JOINS}\\s+${ORG}\\s+as\\s+(?:its\\s+|the\\s+)?(?:new\\s+)?${ROLE_TO_END}`);
  const left = new RegExp(`${who}${LEFT}(?:\\s+as\\s+${ROLE})?(?:\\s+(?:of|at|from)\\s+${ORG})?`);
  const tidy = (s: string | undefined) => s?.replace(/\s+(?:and|&)$/, "").trim() || undefined;
  const dated = news
    .map((n) => ({ n, t: Date.parse(n.date ?? "") }))
    .filter((x) => !isNaN(x.t) && x.t <= now.getTime() + 86_400_000 && now.getTime() - x.t <= MAX_AGE_MS)
    .sort((a, b) => b.t - a.t);
  for (const { n } of dated) {
    for (const text of [n.headline, ...(n.summary ? splitSentences(n.summary) : [])]) {
      if (!mentionsPerson(text, personName)) continue;
      const j = text.match(joined);
      if (j) return { kind: "joined", role: tidy(j[1])!, company: tidy(j[2])!, date: n.date!, headline: n.headline };
      const s = text.match(joins);
      if (s) return { kind: "joined", role: tidy(s[2])!, company: tidy(s[1])!, date: n.date!, headline: n.headline };
      const l = text.match(left);
      if (l) return { kind: "left", role: tidy(l[1]), company: tidy(l[2]), date: n.date!, headline: n.headline };
    }
  }
  return undefined;
}

/**
 * Applies the newest role story to the profile. An appointment sets the
 * current role (the old one stays in the career history); a departure
 * clears it only when it names the current employer.
 */
export function applyRoleChange(bundle: Pick<PersonResearchBundle, "person" | "careerHistory">, change: RoleChange | undefined): string | undefined {
  if (!change) return undefined;
  const p = bundle.person;
  const sameOrg = (a: string | undefined, b: string | undefined) => !!a && !!b && (namesOrg(a, b) || namesOrg(b, a));
  if (change.kind === "joined") {
    if (sameOrg(p.currentCompany, change.company) && p.currentRole?.toLowerCase() === change.role.toLowerCase()) return undefined;
    if (!bundle.careerHistory.some((c) => sameOrg(c.company, change.company) && c.title.toLowerCase() === change.role.toLowerCase())) {
      bundle.careerHistory.unshift({ title: change.role, company: change.company });
    }
    p.currentRole = change.role;
    p.currentCompany = change.company;
    return `current role ${change.role}, ${change.company} (${change.date}: "${change.headline}")`;
  }
  if (!sameOrg(p.currentCompany, change.company)) return undefined;
  const was = `${p.currentRole ?? "role"}, ${p.currentCompany}`;
  delete p.currentRole;
  delete p.currentCompany;
  return `left ${was} (${change.date}: "${change.headline}")`;
}
