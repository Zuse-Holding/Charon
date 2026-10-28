import type { BoardSeatEntry, CareerEntry, PersonProfile, Source } from "../types/research.js";
import { htmlToText, type SearchResult } from "./providers.js";
import { NOT_A_BUSINESS_SITE, ownSite } from "./candidates.js";
import { hostOf } from "./entities/subject.js";
import { mentionsAffiliation } from "./entities/affiliation.js";
import { isNewsNoise, mentionsPerson, normalizeWords } from "./news-noise.js";
import { distinctiveWords } from "./name-match.js";
import { namesOrg } from "./person-checks.js";
import { secEnabled, secJson, secText } from "./sec-http.js";

/**
 * Person-search sources from the Oct 27 handoff (ChatGPT found twice the
 * must-find facts): the executive's bio on their company's own site, SEC
 * proxy and 8-K text, and other companies' board pages. Each one is tied
 * to the person by the organization they were picked with, never by the
 * name alone.
 */

/** The surname as normalized words see it: "McCann" -> "mccann". */
export function surnameOf(personName: string): string {
  const parts = normalizeWords(personName).trim().split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const words = (text: string) => new Set(normalizeWords(text).trim().split(" "));
const pathOf = (url: string) => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } };

const BIO_PATH = /\/(leadership|team|our-team|about|about-us|who-we-are|people|our-people|bios?|management|executives?|board|directors)(\/|$|-)/;

/**
 * The organization's own site: its name in the domain (limbachinc.com), or
 * its initials for a short brand (wm.com for Waste Management).
 */
export function orgSite(host: string, org: string): boolean {
  if (ownSite(host, org)) return true;
  const words = distinctiveWords(org);
  const initials = words.map((w) => w[0]).join("");
  const labels = host.split(".").slice(0, -1);
  return labels.includes(words.join("")) || (initials.length >= 2 && labels.includes(initials));
}

/**
 * Pages on the organization's own site that may hold the person's bio,
 * best first: limbachinc.com/mike-mccann, or an about or leadership page
 * (geckorobotics.com/about-us) whose search snippet needn't name them. The
 * first name may differ ("Mike" for Michael), so the surname is enough on
 * the organization's own domain; the caller confirms it in the page text.
 */
export function officialBioPages(results: SearchResult[], personName: string, org: string): SearchResult[] {
  const last = surnameOf(personName);
  if (!last) return [];
  const scored: { r: SearchResult; score: number }[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const host = hostOf(r.url);
    if (!host || seen.has(r.url) || NOT_A_BUSINESS_SITE.test(host) || !orgSite(host, org)) continue;
    seen.add(r.url);
    const path = pathOf(r.url);
    const inPath = path.includes(last);
    const named = words(`${r.title} ${r.snippet ?? ""}`).has(last);
    const bioPath = BIO_PATH.test(path);
    if (!inPath && !named && !bioPath) continue;
    scored.push({ r, score: (inPath ? 3 : 0) + (named ? 2 : 0) + (bioPath ? 1 : 0) + (mentionsPerson(r.title, personName) ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.r);
}

const BIO_CUES = /\b(age|served|serves|serving|since|joined|appointed|named|elected|director|chair(?:man|woman)?|chief|president|founder|co-founder|prior|previously|degree|university|college|institute|graduated|bachelor|master|mba|b\.?s\.?|ph\.?d)\b/gi;

/**
 * The stretch of a long page about this person: of every window that
 * starts near a mention of the surname, the one with the most biography
 * words (a proxy names a director many times; the bio is one of them).
 */
export function bioExcerpt(text: string, personName: string, chars = 3000): string | undefined {
  const last = surnameOf(personName);
  if (!last) return undefined;
  const re = new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  let best: string | undefined;
  let bestScore = -1;
  let lastStart = -Infinity;
  for (const m of text.matchAll(re)) {
    const start = Math.max(0, m.index! - 300);
    // Mentions inside the window just scored add nothing new.
    if (start - lastStart < chars / 3) continue;
    lastStart = start;
    const window = text.slice(start, start + chars);
    const score = window.match(BIO_CUES)?.length ?? 0;
    if (score > bestScore) { best = window; bestScore = score; }
  }
  return best?.replace(/\s+/g, " ").trim();
}

/** Another organization's board page, or a story about a board seat. */
export function isBoardPage(r: SearchResult, personName: string): boolean {
  const host = hostOf(r.url);
  if (!host || NOT_A_BUSINESS_SITE.test(host) || isNewsNoise(r.url)) return false;
  if (!/\b(board|directors?|governance|trustees?)\b/i.test(`${r.title} ${pathOf(r.url).replace(/[-_/]/g, " ")}`)) return false;
  return words(`${r.title} ${r.snippet ?? ""}`).has(surnameOf(personName));
}

/** Text that names this person and the organization they were picked with. */
export function tiedToOrg(text: string, personName: string, org: string): boolean {
  return mentionsPerson(text, personName) && (namesOrg(text, org) || mentionsAffiliation(text, org));
}

export interface TiedText { url: string; text: string }

// Wire services carry a company's own press releases.
const WIRE_HOST = /(^|\.)(businesswire|prnewswire|globenewswire|accessnewswire|newsfilecorp)\.com$/i;

/**
 * Board seats the extraction found, kept only with a source that vouches
 * for them (Oct 28 handoff: an Amnesty International USA election page
 * read as a seat for Mazzarella). A board page vouches only for the
 * organization whose own site or press release it is; the person's
 * official bio and SEC filings vouch for any organization they name. The
 * person's own employer is a role in the career history, not an outside seat.
 */
export function confirmBoardSeats(
  seats: BoardSeatEntry[],
  sources: { boardPages: TiedText[]; vouched: TiedText[] },
  employers: string[],
): BoardSeatEntry[] {
  const out: BoardSeatEntry[] = [];
  for (const s of seats) {
    if (employers.some((e) => namesOrg(e, s.organization) || namesOrg(s.organization, e))) continue;
    if (out.some((o) => namesOrg(o.organization, s.organization) || namesOrg(s.organization, o.organization))) continue;
    const official = sources.boardPages.find((t) => {
      const host = hostOf(t.url);
      return !!host && (orgSite(host, s.organization) || WIRE_HOST.test(host)) && namesOrg(t.text, s.organization);
    });
    const source = official ?? sources.vouched.find((t) => namesOrg(t.text, s.organization));
    if (!source) continue;
    out.push({ ...s, url: source.url });
  }
  return out;
}

/**
 * A role a source says ended is past (round 21, Gellert at Black Diamond):
 * when the current company only appears in ended roles, it isn't current.
 */
export function clearEndedRole(person: PersonProfile, careerHistory: CareerEntry[]): string | undefined {
  const company = person.currentCompany;
  if (!company) return undefined;
  const same = careerHistory.filter((c) => c.company && (namesOrg(c.company, company) || namesOrg(company, c.company)));
  const ended = (c: CareerEntry) => c.current === false || !!c.end;
  if (same.length === 0 || !same.every(ended)) return undefined;
  const was = `${person.currentRole ?? "role"}, ${company}`;
  delete person.currentRole;
  delete person.currentCompany;
  return `${was} has ended`;
}

/** "Mar 2023 – Jun 2025", "since 2012", "2012 – end date not stated". */
export function roleDates(c: Pick<CareerEntry, "start" | "end" | "current">): string | undefined {
  if (c.start && c.end) return `${c.start} – ${c.end}`;
  if (c.end) return `until ${c.end}`;
  if (c.start) return c.current === false ? `${c.start} – end date not stated` : `since ${c.start}`;
  return c.current === false ? "past role" : undefined;
}

// Profile and directory pages: who someone is, not news about them.
const PROFILE_HOST = /(^|\.)(linkedin|crunchbase|theorg|rocketreach|signalhire|prabook|zoominfo|wikipedia|muckrack|contactout|apollo|theofficialboard)\.[a-z.]+$/i;
const PROFILE_PATH = /\/(in|pub|profiles?|people|person|leadership|team|our-team|bios?|board|board-of-directors|directors|management|executives?)(\/|$)/i;

export function isProfilePage(url: string): boolean {
  const host = hostOf(url);
  return !host || PROFILE_HOST.test(host) || PROFILE_PATH.test(pathOf(url));
}

interface EftsHit {
  _id?: string;
  _source?: { ciks?: string[]; display_names?: string[]; file_date?: string; form?: string; adsh?: string; items?: string[] };
}

/** The filing document's URL from a full-text search hit. */
export function eftsDocUrl(hit: EftsHit): string | undefined {
  const [adsh, file] = (hit._id ?? "").split(":");
  const cik = hit._source?.ciks?.[0]?.replace(/^0+/, "");
  return adsh && file && cik ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${file}` : undefined;
}

const filerName = (n: string) => n.replace(/\s*\((CIK[^)]*|[A-Z0-9.,\s-]{1,20})\)/g, "").trim();

/** Hits filed by the organization itself, newest first. */
export function filedBy(hits: EftsHit[], org: string): EftsHit[] {
  return hits
    .filter((h) => (h._source?.display_names ?? []).some((n) => namesOrg(filerName(n), org) || namesOrg(org, filerName(n))))
    .sort((a, b) => (b._source?.file_date ?? "").localeCompare(a._source?.file_date ?? ""));
}

export interface SecExcerpt { label: string; url: string; date?: string; text: string }

/**
 * The person's bio in the organization's newest proxy (DEF 14A: age,
 * tenure, education, other directorships) and in its two newest 8-Ks on
 * officer and director changes (item 5.02: appointment dates). Off with
 * the rest of SEC while SEC_ENABLED isn't on.
 */
export async function secPersonExcerpts(personName: string, org: string): Promise<SecExcerpt[]> {
  if (!secEnabled()) return [];
  const orgWords = distinctiveWords(org).join(" ");
  if (!orgWords) return [];
  // Proxies often add a middle initial ("Michael M. McCann"): the surname
  // and the organization, both required, then the filer must be the organization.
  const q = encodeURIComponent(`"${surnameOf(personName)}" ${orgWords}`);
  const search = (forms: string) => secJson<{ hits?: { hits?: EftsHit[] } }>(`https://efts.sec.gov/LATEST/search-index?q=${q}&forms=${encodeURIComponent(forms)}`);
  const [proxies, eightKs] = await Promise.all([search("DEF 14A"), search("8-K")]);
  // An 8-K's announcement is short; the proxy bio is the long one.
  const picks: { hit: EftsHit; label: string; chars: number }[] = [
    ...filedBy(proxies?.hits?.hits ?? [], org).slice(0, 1).map((hit) => ({ hit, label: "SEC proxy statement (DEF 14A)", chars: 3000 })),
    ...filedBy(eightKs?.hits?.hits ?? [], org)
      .filter((h) => (h._source?.items ?? []).includes("5.02"))
      .slice(0, 2)
      .map((hit) => ({ hit, label: "SEC 8-K, officer or director change (item 5.02)", chars: 1500 })),
  ];
  const out: SecExcerpt[] = [];
  for (const { hit, label, chars } of picks) {
    const url = eftsDocUrl(hit);
    const html = url ? await secText(url) : null;
    const text = html ? bioExcerpt(htmlToText(html), personName, chars) : undefined;
    if (url && text) out.push({ label, url, date: hit._source?.file_date, text });
  }
  return out;
}

export function sourceOf(url: string, title: string, usedFor: string): Source {
  return { url, title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] };
}

/** The value, or the fallback once `ms` pass: an optional step never sinks the report. */
export async function within<T>(p: Promise<T>, ms: number, fallback: T, label?: string): Promise<T> {
  if (ms <= 0) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      if (label) console.warn(`[people-agent] ${label}: no answer in ${Math.round(ms / 1000)}s, going on without it`);
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([p.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// A seat on a board, not an operating job ("Non-Executive Chair", "Director").
const BOARD_TITLE = /\b(non-?executive|independent|lead) (chair\w*|director)\b|\bboard (member|of directors|chair\w*)\b|^(director|trustee|chair(man|woman|person)?)$/i;

const sameOrg = (a: string | undefined, b: string | undefined) => !!a && !!b && (namesOrg(a, b) || namesOrg(b, a));

/**
 * The picked organization sets the current role (Oct 28 handoff:
 * Mazzarella's report led with WM's non-executive chair, not Graybar). Its
 * newest open role in the career history wins over any other company; a
 * board seat elsewhere never stands as the current role.
 */
export function anchorCurrentRole(person: PersonProfile, careerHistory: CareerEntry[], org: string): string | undefined {
  if (sameOrg(person.currentCompany, org)) return undefined;
  const open = careerHistory.find((c) => sameOrg(c.company, org) && c.current !== false && !c.end && !BOARD_TITLE.test(c.title));
  const was = person.currentRole ? `${person.currentRole}, ${person.currentCompany ?? "?"}` : undefined;
  if (open) {
    person.currentRole = open.title;
    person.currentCompany = open.company;
    return `current role ${open.title}, ${open.company} (the picked organization) over ${was ?? "none"}`;
  }
  if (person.currentRole && BOARD_TITLE.test(person.currentRole)) {
    delete person.currentRole;
    person.currentCompany = org;
    return `${was} is a board seat, not the current role; current company ${org}`;
  }
  return undefined;
}

const SCHOOL_WORD = /\b(university|college|institute|school|academy|polytechnic|conservatory|seminary)\b/i;

/**
 * Education kept only when a source tied to this person and their
 * organization names the school near the person's name (Oct 28 handoff: a
 * namesake's "GCSEs and A-levels, Edwards School" in Loosararian's report).
 * A degree the source doesn't word that way is dropped and the school kept
 * (Grove City's "B.A.Sc." for a B.S. in Electrical Engineering).
 */
export function verifyEducation(education: string, tied: string[], personName: string): string | undefined {
  const last = surnameOf(personName);
  const near = tied.flatMap((t) => {
    const out: string[] = [];
    for (const m of t.matchAll(new RegExp(`\\b${last}\\b`, "gi"))) out.push(t.slice(Math.max(0, m.index! - 800), m.index! + 800));
    return out;
  });
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kept: string[] = [];
  for (const entry of education.split(/\s*;\s*/).filter(Boolean)) {
    const parts = entry.split(/\s*,\s*/);
    const schoolAt = parts.findIndex((p) => SCHOOL_WORD.test(p));
    const school = schoolAt >= 0 ? parts[schoolAt] : parts[parts.length - 1];
    const initials = distinctiveWords(school).map((w) => w[0]).join("");
    const window = near.find((w) => namesOrg(w, school) || (initials.length >= 3 && new RegExp(`\\b${initials}\\b`, "i").test(w)));
    if (!window) continue;
    // Degree and year only as the source words them.
    const worded = parts.filter((p) => p !== school && squash(window).includes(squash(p)));
    kept.push([...worded, school].join(", "));
  }
  return kept.length ? kept.join("; ") : undefined;
}

/**
 * Someone else the sources name as the organization's CEO ("Thomas Vozzo,
 * CEO of Homeboy Industries"): the person's own "CEO" title there conflicts.
 */
export function otherCeoOf(texts: string[], org: string, personName: string): string | undefined {
  const NAME = "([A-Z][a-z]+(?: [A-Z]\\.)? [A-Z][a-zA-Z'’-]+)";
  const ORG = distinctiveWords(org).length ? org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  if (!ORG) return undefined;
  const CEO = "(?:CEO|chief executive(?: officer)?)";
  const patterns = [
    new RegExp(`${NAME},? (?:the |its )?(?:president and )?${CEO} of ${ORG}`, "i"),
    new RegExp(`${ORG}(?:['’]s)? (?:president and )?${CEO},? ${NAME}`, "i"),
  ];
  const last = surnameOf(personName);
  for (const t of texts) for (const re of patterns) {
    const name = t.match(re)?.[1];
    if (name && !words(name).has(last)) return name;
  }
  return undefined;
}

/** "Founder and CEO" -> "Founder" when another person is the CEO; "" when nothing is left. */
export function withoutCeo(title: string): string {
  return title.replace(/\s*(?:,|and|&)?\s*\b(?:CEO|chief executive(?: officer)?)\b\s*(?:,|and|&)?\s*/gi, " ")
    .replace(/\s+/g, " ").replace(/^(and|&|,)\s+|\s+(and|&|,)$/gi, "").trim();
}
