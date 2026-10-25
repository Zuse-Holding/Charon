import type { LeadershipEntry } from "../types/research.js";
import { normalizeWords } from "./news-noise.js";
import { sourceScore, sourceTier } from "./source-quality.js";
import { typoOf } from "./name-match.js";

/**
 * Leadership clean-up after extraction (launch fixes 6, 7 and 9). Pure
 * code: one entry per person, one holder per exclusive title, and a
 * low-confidence mark on anyone only a scraped directory names.
 */

const CREDENTIAL = /\b(m\.?s|m\.?a|ph\.?d|m\.?d|bcba-?d?|lmft|lcsw|cpa|esq|mba|jr|sr|ii|iii)\b\.?/gi;

// A comma tail that is only credentials, not a first name.
const CREDENTIAL_ONLY = /^[\s,.]*((m\.?s|m\.?a|ph\.?d|m\.?d|bcba-?d?|lmft|lcsw|cpa|esq|mba|jr|sr|ii|iii)\b\.?[\s,]*)+$/i;

/** "Dr. Lilia Agadganian, M.S., BCBA" -> "lilia agadganian". */
export function personKey(name: string): string {
  const words = normalizeWords(name.replace(/^dr\.?\s+/i, "").replace(CREDENTIAL, " ")).trim().split(" ").filter(Boolean);
  // First and last name: a middle initial or name doesn't make two people.
  return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(" ");
}

/** Titles split into roles: "President and CEO" -> ["President", "CEO"]. */
function roles(title: string): string[] {
  return title.split(/\s*(?:,|&|\/|\band\b|;)\s*/i).map((r) => r.trim()).filter(Boolean);
}

function mergeTitles(a: string, b: string): string {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (!b || la.includes(lb) || lb === "unknown") return a;
  if (!a || lb.includes(la) || la === "unknown") return b;
  const merged = [...roles(a)];
  for (const r of roles(b)) if (!merged.some((m) => m.toLowerCase() === r.toLowerCase())) merged.push(r);
  return merged.join(", ");
}

/** One entry per person: titles merged, the best-sourced URL kept. */
/**
 * Same person under two spellings (launch fix 44: Promise listed Lilia
 * Agadganian twice): the same last name and a first name starting with
 * the same three letters, in either name order ("AGADGANIAN, LILIA").
 */
export function samePerson(a: string, b: string): boolean {
  const ka = personKey(a.includes(",") && !CREDENTIAL_ONLY.test(a.split(",").slice(1).join(",")) ? a.split(",").reverse().join(" ") : a).split(" ");
  const kb = personKey(b.includes(",") && !CREDENTIAL_ONLY.test(b.split(",").slice(1).join(",")) ? b.split(",").reverse().join(" ") : b).split(" ");
  if (ka.length < 2 || kb.length < 2) return ka.join(" ") === kb.join(" ");
  // Last names one letter apart in six are one spelling slip ("Agadganian"
  // and "Agadjanian"), with the same start to the first name.
  const lastSame = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && a[0] === b[0] && typoOf(a, b));
  // An initial matches the name it stands for (round 17: Graybar listed
  // "Kathleen M. Mazzarella" and the 10-K's "K. M. Mazzarella").
  const firstSame = (a: string, b: string) => a.slice(0, 3) === b.slice(0, 3) || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
  const match = (x: string[], y: string[]) => lastSame(x[x.length - 1], y[y.length - 1]) && firstSame(x[0], y[0]);
  return match(ka, kb) || match(ka, [...kb].reverse());
}

export function dedupeLeadership(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  const out: LeadershipEntry[] = [];
  for (const e of entries) {
    const key = personKey(e.name);
    if (!key) continue;
    const prev = out.find((o) => samePerson(o.name, e.name));
    if (!prev) {
      out.push({ ...e });
      continue;
    }
    // Another organization's site lists the roles a person holds there
    // (launch fix 66: MJW's Mark Weinstein got titles from dignitymoves.org):
    // only the company's own pages, filings and the press add titles.
    const tier = e.sourceUrl ? sourceTier(e.sourceUrl, subjectDomain) : "primary";
    if (tier === "primary" || tier === "press" || tier === "reference" || tier === "directory") prev.title = mergeTitles(prev.title, e.title);
    if (!prev.bio && e.bio) prev.bio = e.bio;
    const score = (u?: string) => (u ? sourceScore(u, subjectDomain) : -1);
    if (score(e.sourceUrl) > score(prev.sourceUrl)) {
      prev.sourceUrl = e.sourceUrl;
      prev.asOf = e.asOf ?? prev.asOf;
    }
    // The fuller spelling of the name wins ("Lilia Agadganian, BCBA" over "Lilia").
    if (e.name.length > prev.name.length && personKey(e.name) === personKey(prev.name)) prev.name = e.name;
  }
  return out;
}

// One person holds each of these at a time. Co-CEOs share the CEO seat
// (Homeboy: Steve Delgado and Shirley Torres), so a co-CEO never conflicts
// with another, only with a sole "CEO" from a different source.
const EXCLUSIVE: { label: string; re: RegExp; shared?: RegExp }[] = [
  { label: "CEO", re: /^(ceo|chief executive( officer)?)$/i, shared: /^co-?(ceo|chief executive( officer)?)$/i },
  { label: "President", re: /^president$/i },
  { label: "Chair", re: /^(chair(man|woman|person)?( of the board)?|executive chair(man)?)$/i },
  { label: "CFO", re: /^(cfo|chief financial officer)$/i },
  { label: "COO", re: /^(coo|chief operating officer)$/i },
  { label: "CTO", re: /^(cto|chief technology officer)$/i },
];

/** Newer first, then the company's own site over anything else. */
function newer(a: LeadershipEntry, b: LeadershipEntry, subjectDomain?: string): boolean {
  const ta = a.asOf ? Date.parse(a.asOf) : NaN;
  const tb = b.asOf ? Date.parse(b.asOf) : NaN;
  if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta > tb;
  if (!isNaN(ta) !== !isNaN(tb)) return !isNaN(ta);
  const sa = a.sourceUrl ? sourceScore(a.sourceUrl, subjectDomain) : 0;
  const sb = b.sourceUrl ? sourceScore(b.sourceUrl, subjectDomain) : 0;
  return sa > sb;
}

/**
 * Two people listed with the same exclusive title: the newest primary
 * source keeps it; the other keeps their remaining titles and is marked
 * possibly outdated for that one (Oct 2026: Darway president, Marrs CEO
 * and chair, where an older page had Marrs as "President and CEO").
 *
 * Someone whose every title went to someone else is a former officer,
 * not current leadership, and drops off the list (launch fix 35: Limbach's
 * Top Risk was "two CEOs" built on Charlie Bacon, a former CEO).
 */
export function resolveTitleConflicts(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  const former = new Set<LeadershipEntry>();
  for (const { label, re, shared } of EXCLUSIVE) {
    const holds = (e: LeadershipEntry) => !former.has(e) && roles(e.title).some((r) => re.test(r) || !!shared?.test(r));
    const holders = entries.filter(holds);
    if (holders.length < 2) continue;
    const winner = holders.reduce((best, e) => (newer(e, best, subjectDomain) ? e : best));
    const winnerShares = !!shared && roles(winner.title).some((r) => shared.test(r));
    for (const e of holders) {
      if (e === winner) continue;
      // The winner is one of several co-CEOs: the others keep the seat.
      if (winnerShares && roles(e.title).some((r) => shared!.test(r))) continue;
      const rest = roles(e.title).filter((r) => !re.test(r) && !shared?.test(r));
      if (rest.length) e.title = rest.join(" and ");
      // Off the list only when a dated, newer source says someone else
      // holds it (a filing, a news item); two undated pages that disagree
      // keep both, labeled (launch fix 44: Crumbl lost Sawyer Hemsley).
      else if (winner.asOf && (!e.asOf || Date.parse(winner.asOf) > Date.parse(e.asOf))) former.add(e);
      if (!e.outdatedTitles?.includes(label)) e.outdatedTitles = [...(e.outdatedTitles ?? []), label];
    }
  }
  return entries.filter((e) => !former.has(e));
}

// How the page writes each exclusive title near a name.
const TITLE_WORDS: Record<string, RegExp> = {
  CEO: /\b(ceo|chief executive)\b/i, President: /\bpresident\b(?!\s+of\s+(the\s+)?board)/i, Chair: /\bchair/i,
  CFO: /\b(cfo|chief financial)\b/i, COO: /\b(coo|chief operating)\b/i, CTO: /\b(cto|chief technology)\b/i,
};

/** The pages give this title within a sentence's reach of the name. */
export function titleBacked(name: string, label: string, texts: string[]): boolean {
  const words = TITLE_WORDS[label];
  if (!words) return true;
  const n = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
  // The sentence or list item that names the person, not the one beside it.
  return texts.some((t) => t.split(/(?<=[.;!?])\s+|\n+|\s[|•·]\s/).some((part) => n.test(part) && words.test(part.replace(n, " "))));
}

/** "Charles Conn, Board Chair." -> "Board Chair": the title written right after the name. */
function titleAfter(name: string, texts: string[]): string | undefined {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${n}\\s*(?:,|-|–|—|\\|)\\s*([A-Z][\\w&'’-]*(?:\\s+(?:[A-Z][\\w&'’-]*|of|the|and)){0,5})`);
  for (const t of texts) {
    const m = t.match(re)?.[1]?.trim();
    if (m && /\b(chair|board|director|founder|president|officer|partner|trustee|member)\b/i.test(m)) return m.replace(/\s+(of|the|and)$/i, "");
  }
  return undefined;
}

/**
 * Several people read off the site as holding one exclusive title (round
 * 11: Charles Conn and Ayana Elizabeth Johnson listed as CEO beside Ryan
 * Gellert on patagonia.com): each claim must be in the text near that
 * person's name. An unbacked claim takes the title the page does give near
 * the name, or the person drops off. A lone holder is never touched.
 */
export function settleSiteTitles(entries: LeadershipEntry[], texts: string[]): LeadershipEntry[] {
  const dropped = new Set<LeadershipEntry>();
  for (const { label, re } of EXCLUSIVE) {
    const holders = entries.filter((e) => roles(e.title).some((r) => re.test(r)));
    if (holders.length < 2) continue;
    const backed = holders.filter((e) => titleBacked(e.name, label, texts));
    if (!backed.length || backed.length === holders.length) continue;
    for (const e of holders) {
      if (backed.includes(e)) continue;
      const rest = roles(e.title).filter((r) => !re.test(r));
      const near = titleNear(e.name, texts) ?? titleAfter(e.name, texts);
      const replacement = near && !re.test(near) ? near : undefined;
      if (rest.length) e.title = rest.join(" and ");
      else if (replacement) e.title = replacement;
      else dropped.add(e);
    }
  }
  return entries.filter((e) => !dropped.has(e));
}

const SOLE_FOUNDER = /^(the )?founder$/i;

/**
 * A second "Founder" (launch fix 37): Homeboy listed Martin Cabrera Jr. as
 * "CEO and Founder" beside Fr. Gregory Boyle. Co-founders are normal; two
 * sole founders aren't. The better-sourced claim keeps it, and the other
 * loses the title, marked disputed. Equally sourced claims both stand.
 */
export function resolveFounderClaims(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  const founders = entries.filter((e) => roles(e.title).some((r) => SOLE_FOUNDER.test(r)));
  if (founders.length < 2) return entries;
  const score = (e: LeadershipEntry) => (e.sourceUrl ? sourceScore(e.sourceUrl, subjectDomain) : 0);
  const best = Math.max(...founders.map(score));
  const dropped = new Set<LeadershipEntry>();
  for (const e of founders) {
    if (score(e) >= best) continue;
    const rest = roles(e.title).filter((r) => !SOLE_FOUNDER.test(r));
    if (rest.length) e.title = rest.join(" and ");
    else dropped.add(e);
    e.disputedTitles = [...(e.disputedTitles ?? []), "Founder"];
  }
  return entries.filter((e) => !dropped.has(e));
}

/** Named only by a scraped people directory (RocketReach, Comparably...). */
export function markDirectoryOnly(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  for (const e of entries) {
    if (e.sourceUrl && sourceTier(e.sourceUrl, subjectDomain) === "directory") e.lowConfidence = true;
  }
  return entries;
}

const ACRONYM = /\b(ceo|coo|cfo|cto|cio|cmo|cro|cso|cpo|chro|evp|svp|vp|gm|hr|it|bcba|esop)\b/gi;

/** "coo" -> "COO", "co-founder and ceo" -> "Co-founder and CEO" (launch fix 44). */
export function tidyTitle(title: string): string {
  let t = title.trim().replace(ACRONYM, (x) => x.toUpperCase());
  if (/^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

const PERSON = "((?:(?:Father|Fr\\.|Rev\\.|Dr\\.)\\s+)?[A-Z][a-z]+(?:\\s+[A-Z]\\.)?(?:\\s+[A-Z][a-zA-Z'’-]+){1,2})";

/** Names the company's own copy or the press says founded it ("founded in 1988 by Father Greg Boyle"). */
export function foundedBy(texts: string[]): string[] {
  const re = new RegExp(`\\b(?:founded|started|established)(?:\\s+in\\s+\\d{4})?\\s+by\\s+${PERSON}(?:\\s+and\\s+${PERSON})?`, "g");
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(re)) for (const n of [m[1], m[2]]) if (n && !out.includes(n)) out.push(n);
  return out;
}

/**
 * A sole "Founder" the company's own description or the press doesn't
 * name, when they do name the founder (launch fix 44: Homeboy, "founded by
 * Father Greg Boyle", listed Martin Cabrera Jr. as "CEO and Founder").
 */
export function checkFoundersAgainst(entries: LeadershipEntry[], founders: string[]): LeadershipEntry[] {
  if (!founders.length) return entries;
  const known = (name: string) => founders.some((f) => samePerson(f.replace(/^(father|fr\.|rev\.|dr\.)\s+/i, ""), name)
    || personKey(f).split(" ").pop() === personKey(name).split(" ").pop());
  // The text is about this company only if a founder it names is on the
  // list too; "XYZ, founded by Jane Doe, partners with..." settles nothing.
  if (!entries.some((e) => known(e.name))) return entries;
  const dropped = new Set<LeadershipEntry>();
  for (const e of entries) {
    if (!roles(e.title).some((r) => SOLE_FOUNDER.test(r)) || known(e.name)) continue;
    const rest = roles(e.title).filter((r) => !SOLE_FOUNDER.test(r));
    if (rest.length) e.title = rest.join(" and ");
    else dropped.add(e);
    if (!e.disputedTitles?.includes("Founder")) e.disputedTitles = [...(e.disputedTitles ?? []), "Founder"];
  }
  return entries.filter((e) => !dropped.has(e));
}

// Case-insensitive by hand: the "i" flag would let a name's [A-Z] match
// any lowercase word.
const ci = (p: string) => p.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
// Senior and executive VPs with their remit (round 15: Graybar's April 2026
// changes named "Senior Vice President – North American Subsidiaries").
const NEWS_TITLE = `((?:${ci("senior vice president|executive vice president|president|chief executive officer|ceo|chief operating officer|coo|chief financial officer|cfo|chief technology officer|cto|executive chairman|executive chair|chairman of the board|chairman|chairwoman|chair")})(?:\\s+${ci("and general manager")}|\\s+[–—-]\\s+[A-Z][\\w]+(?:\\s+[A-Z][\\w]+){0,4})?)`;
// A headline about leadership whose article names the people.
const LEADERSHIP_NEWS = /\b(leadership (changes?|transition|appointments?)|executive (changes?|appointments?|promotions?)|names|appoints|promotes|promotions?|new (ceo|president|cfo|coo))\b/i;

/**
 * Appointments the news reports, as dated leadership entries (launch fix
 * 44: ACCO's news covered Chuck Darway's promotion to president while the
 * report still listed Jeffrey Marrs as president). Dated, so the title-
 * conflict check prefers them over an undated page.
 */
export function appointmentsFromNews(news: { headline: string; summary?: string; articleText?: string; date?: string; url?: string }[]): LeadershipEntry[] {
  const out: LeadershipEntry[] = [];
  // ci() only on plain words: it would turn "\\w" into "\\[wW]".
  const succeed = `(?:${ci("to succeed|succeeds")}\\s+[A-Z][\\w'’-]+(?:\\s+[A-Z][\\w'’-]+)?\\s+${ci("as")})`;
  const verbs = `(?:${ci("has been |was |is |will be ")})?(?:${ci("named|promoted to|appointed|elevated to|tapped as|selected as|becomes|to become")}|${succeed})`;
  // "David A. Bender, who currently serves as ..., has been named ..."
  const who = `(?:\\s+${ci("who")}\\b[^.;]{0,120}?,)?`;
  const after = new RegExp(`${PERSON},?${who}\\s+${verbs}\\s+(?:${ci("as")}\\s+)?(?:${ci("the")}\\s+)?(?:${ci("company's|its|new")}\\s+)*${NEWS_TITLE}\\b`, "g");
  const names = new RegExp(`\\b${ci("(?:names|appoints|promotes|taps|elevates)")}\\s+${PERSON}\\s+(?:${ci("as|to")}\\s+)?(?:${ci("its|new")}\\s+)*${NEWS_TITLE}\\b`, "g");
  for (const n of news) {
    if (!n.date || !n.url) continue;
    // The article itself when the headline names no one ("Graybar Announces Leadership Changes").
    const text = `${n.headline}. ${n.summary ?? ""}${n.articleText && LEADERSHIP_NEWS.test(n.headline) ? ` ${n.articleText}` : ""}`;
    for (const re of [after, names]) {
      for (const m of text.matchAll(re)) {
        const name = m[1].trim();
        if (/^(The|Company|Board|Inc)\b/.test(name)) continue;
        out.push({ name, title: tidyTitle(m[2]), sourceUrl: n.url, asOf: n.date });
      }
    }
  }
  return out;
}

/**
 * A title the news gives someone already listed, in apposition: "Troy
 * Demmer, company president and co-founder" (round 16: Gecko listed him as
 * "Cofounder" only). Never a former title, and never adds a person.
 */
export function titlesFromNews(entries: LeadershipEntry[], news: { headline: string; summary?: string; articleText?: string; date?: string; url?: string }[]): LeadershipEntry[] {
  for (const e of entries) {
    const name = e.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${name},\\s+(?:${ci("the")}\\s+)?(?:(?:${ci("company")}|${ci("its")}|[A-Z][\\w&.'’-]*(?:'s|’s))\\s+)?(${ci("former")}\\s+)?${NEWS_TITLE}`);
    for (const n of news) {
      if (!n.date || !n.url) continue;
      const m = `${n.headline}. ${n.summary ?? ""} ${n.articleText ?? ""}`.match(re);
      if (!m || m[1]) continue;
      const title = tidyTitle(m[2]);
      if (!roles(e.title).some((r) => r.toLowerCase() === title.toLowerCase())) e.title = mergeTitles(e.title, title);
      break;
    }
  }
  return entries;
}

/**
 * News appointments joined into the list: a person already listed gets the
 * new title and the news date; anyone else is added.
 */
export function applyAppointments(entries: LeadershipEntry[], appointments: LeadershipEntry[]): LeadershipEntry[] {
  for (const a of appointments) {
    const known = entries.find((e) => samePerson(e.name, a.name));
    if (!known) { entries.push(a); continue; }
    if (!roles(known.title).some((r) => r.toLowerCase() === a.title.toLowerCase())) known.title = mergeTitles(known.title, a.title);
    if (!known.asOf || Date.parse(a.asOf!) > Date.parse(known.asOf)) { known.asOf = a.asOf; known.sourceUrl = a.sourceUrl; }
  }
  return entries;
}

const STEPPED_DOWN = "(?:steps?|stepped|stepping|to step|will step) (?:down|away)|resign(?:s|ed|ing)?|retir(?:es|ed|ing)|depart(?:s|ed|ing)|exit(?:s|ed|ing)|(?:is |was )?ousted";
const REMAINS = /\b(remains?|remaining|stays? on|will stay|continues? as|will continue as)\b/i;

/**
 * Leaders the news says stepped down, after the source that lists them
 * (round 15: Crumbl listed Jason McGowan as CEO while its own news said the
 * founders stepped down in May 2026). A founder stays a founder; a board
 * seat the story says they keep stays; any other title goes, and so does
 * anyone left with none. An undated source counts as older than the news,
 * and so does a social post: its date isn't when the title was given
 * (round 15: McGowan's "CEO" came from an Oct 2026 Facebook post).
 */
export function applyDepartures(entries: LeadershipEntry[], news: { headline: string; summary?: string; date?: string }[]): LeadershipEntry[] {
  const out: LeadershipEntry[] = [];
  for (const e of entries) {
    const asOf = e.asOf && !(e.sourceUrl && sourceTier(e.sourceUrl) === "forum") ? e.asOf : undefined;
    const last = personKey(e.name).split(" ").pop() ?? "";
    const who = [e.name, ...(last.length >= 4 ? [last] : []), ...(/founder/i.test(e.title) ? ["(?:co-?)?founders?"] : [])]
      .map((w) => (w.startsWith("(") ? w : w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const left = new RegExp(`\\b(?:${who.join("|")})\\b[^.;]{0,80}?\\b(?:${STEPPED_DOWN})\\b[^.;]*`, "i");
    const story = news.find((n) => n.date && !isNaN(Date.parse(n.date)) && (!asOf || Date.parse(n.date) > Date.parse(asOf))
      && left.test(`${n.headline}. ${n.summary ?? ""}`));
    if (!story) { out.push(e); continue; }
    const said = `${story.headline}. ${story.summary ?? ""}`.match(left)![0];
    const kept = roles(e.title).filter((r) => /founder/i.test(r) || (REMAINS.test(said) && /\b(chair\w*|board|director)\b/i.test(r)));
    if (!kept.length) continue;
    out.push({ ...e, title: kept.join(", ") });
  }
  return out;
}

/** Rank of a title: 0 the top seat, 5 below management. */
export function seniority(title: string): number {
  const t = title.toLowerCase();
  if (/\b(chief executive|ceo|co-ceo|president|chair|founder|owner|managing partner|executive director)\b/.test(t) && !/\bvice president\b|\bvp\b/.test(t)) return 0;
  if (/\bchief\b|\bc[fotimrs]o\b|general counsel/.test(t)) return 1;
  if (/\b(evp|svp|executive vice president|senior vice president)\b/.test(t)) return 2;
  if (/\b(vice president|vp|partner|principal)\b/.test(t)) return 3;
  if (/\b(director|head of)\b/.test(t)) return 4;
  return 5;
}

/**
 * Executives first, by seniority (launch fix 66: Graybar showed district
 * managers instead of its officers); once three executives are listed,
 * managers and staff below director drop off.
 */
/** @param national A national company: field managers never count as its leadership (launch fix 84: Graybar). */
export function rankLeadership(entries: LeadershipEntry[], national = false): LeadershipEntry[] {
  const ranked = entries.map((e, i) => ({ e, i, r: seniority(e.title) })).sort((a, b) => a.r - b.r || a.i - b.i);
  const executives = ranked.filter((x) => x.r <= 3).length;
  // A field manager is never leadership beside an executive (launch fix
  // 78: Graybar still listed district managers).
  return ranked.filter((x) => (executives < 3 || x.r <= 4) && !((national || executives > 0) && FIELD_MANAGER.test(x.e.title))).map((x) => x.e);
}

const FIELD_MANAGER = /\b(district|branch|area|territory|store|location|zone|regional sales|account|sales) manager\b/i;

// Words a headline or menu puts where a name should be (launch fix 82:
// "New Senior Vice / President" was listed as a person).
const NOT_NAME_WORD = /^(new|senior|vice|president|chief|officer|executive|director|manager|head|team|our|the|and|of|board|leadership|about|contact|meet|named|appoints|announces|welcomes|promoted|company|group|inc|llc)$/i;
const NAME_PARTICLE = /^(de|da|del|della|di|du|van|von|der|den|la|le|bin|al|st\.?)$/i;

/** A person's name: two to five words, each capitalized (or a particle like "van"), no title words, digits or slashes. */
export function isPersonName(name: string): boolean {
  const clean = name.replace(/^dr\.?\s+/i, "").replace(/,.*$/, "").trim();
  if (/[\d/|@:;]/.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => !NOT_NAME_WORD.test(w.replace(/[.,]$/, "")) && (/^[A-ZÀ-ɏ]/.test(w) || NAME_PARTICLE.test(w)));
}

export function cleanLeadership(entries: LeadershipEntry[], subjectDomain?: string, national = false): LeadershipEntry[] {
  for (const e of entries) e.title = tidyTitle(e.title);
  const deduped = dedupeLeadership(entries.filter((e) => isPersonName(e.name)), subjectDomain);
  return rankLeadership(markDirectoryOnly(resolveFounderClaims(resolveTitleConflicts(deduped, subjectDomain), subjectDomain), subjectDomain), national);
}

const TITLE = "(?:co-?ceo|co-?chief executive officer|co-?founder(?:\\s+(?:and|&)\\s+(?:ceo|president|cto|chief [a-z]+ officer))?|founder|chief [a-z]+ officer|ceo|cto|coo|cfo|president|chair(?:man|woman)?|managing (?:director|partner)|vice president(?: of [a-z ]{3,30})?|head of [a-z ]{3,30}|general counsel)";

/**
 * A title the pages give next to the name ("Jake Loosararian, CEO", "CEO
 * Jake Loosararian") for an entry extracted without one (launch fix 32).
 */
export function titleNear(name: string, texts: string[]): string | undefined {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const after = new RegExp(`${n}\\s*(?:,|-|–|—|\\(|\\bis\\b|\\bas\\b)?\\s*(?:the\\s+|our\\s+)?(${TITLE})\\b`, "i");
  const before = new RegExp(`\\b(${TITLE})\\s*(?:,|-|–|—|:)?\\s*${n}`, "i");
  for (const t of texts) {
    const m = t.match(after) ?? t.match(before);
    if (m) return m[1].replace(/\b(ceo|cto|coo|cfo)\b/gi, (x) => x.toUpperCase()).replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Of|And)\b/g, (x) => x.toLowerCase());
  }
  return undefined;
}
