import type { BoardSeatEntry, CareerEntry, PersonProfile, Source } from "../types/research.js";
import { htmlToText, type SearchResult } from "./providers.js";
import { NOT_A_BUSINESS_SITE, ownSite } from "./candidates.js";
import { hostOf } from "./entities/subject.js";
import { mentionsAffiliation } from "./entities/affiliation.js";
import { isNewsNoise, mentionsPerson, normalizeWords } from "./news-noise.js";
import { distinctiveWords, nameWords } from "./name-match.js";
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

const BOARD_WORD = /\b(board|directors?|chair\w*|trustees?|governance)\b/i;

/** The organization is named within a sentence's reach of a board word. */
function boardNear(text: string, org: string): boolean {
  return text.split(/(?<=[.;!?])\s+/).some((sn) => BOARD_WORD.test(sn) && namesOrgLoose(sn, org));
}

/**
 * The text names the organization, by its initials as well (Oct 28: the
 * model called it "WM" where Cigna's bio says "Waste Management", or the
 * other way round).
 */
export function namesOrgLoose(text: string, org: string): boolean {
  if (namesOrg(text, org)) return true;
  const acronym = org.replace(/[^A-Za-z]/g, "");
  if (/^[A-Z]{2,5}$/.test(acronym) && acronym === org.replace(/[\s.&]/g, "")) {
    // "WM" in the text as "Waste Management".
    const re = new RegExp(`\\b${acronym.split("").map((c) => `${c}[a-z]+`).join("\\s+")}\\b`);
    return re.test(text);
  }
  // "National Association of Wholesaler-Distributors" is NAW: a hyphenated word counts once.
  const all = org.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && nameWords(w).length > 0);
  const initials = all.map((w) => w[0]).join("").toUpperCase();
  return all.length >= 2 && initials.length <= 5 && new RegExp(`\\b${initials}\\b`).test(text);
}

// Wire services carry a company's own press releases.
const WIRE_HOST = /(^|\.)(businesswire|prnewswire|globenewswire|accessnewswire|newsfilecorp)\.com$/i;

/**
 * Board seats the extraction found, kept only with a source that vouches
 * for them (Oct 28 handoff: an Amnesty International USA election page
 * read as a seat for Mazzarella). A board page vouches only for the
 * organization whose own site or press release it is; the person's
 * official bio and SEC filings vouch for any organization they name. The
 * person's own employer is a role in the career history, not an outside seat.
 * Any other text naming the person and their employer vouches for a board
 * it names next to a board word (Oct 28 overcorrection: Mazzarella lost WM,
 * Cigna and Core & Main once the stricter rule shipped).
 */
export function confirmBoardSeats(
  seats: BoardSeatEntry[],
  sources: { boardPages: TiedText[]; vouched: TiedText[]; tied?: TiedText[] },
  employers: string[],
): BoardSeatEntry[] {
  const out: BoardSeatEntry[] = [];
  for (const s of seats) {
    if (employers.some((e) => namesOrg(e, s.organization) || namesOrg(s.organization, e))) continue;
    // "Waste Management" and "WM" are one board.
    if (out.some((o) => namesOrgLoose(o.organization, s.organization) || namesOrgLoose(s.organization, o.organization))) continue;
    const official = sources.boardPages.find((t) => {
      const host = hostOf(t.url);
      return !!host && (orgSite(host, s.organization) || WIRE_HOST.test(host)) && namesOrgLoose(t.text, s.organization);
    });
    const source = official ?? sources.vouched.find((t) => namesOrgLoose(t.text, s.organization))
      // A tied board page names their other boards too (Cigna's bio lists WM and Core & Main).
      ?? [...sources.boardPages, ...(sources.tied ?? [])].find((t) => boardNear(t.text, s.organization));
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

const NOT_A_SCHOOL = /\b(self|taught|degree|bachelor|master|doctorate|diploma|honorary|high school diploma|ged|n\/a|unknown|various)\b/i;
/** "Gonzaga" or "Drexel" with no "University": a capitalized name, not a degree or a note. */
const looksLikeSchool = (part: string) => /^[A-Z][\w’'&.-]*(\s+[A-Z][\w’'&.-]*)*$/.test(part.trim()) && !ABBREVIATION.test(part.trim()) && !NOT_A_SCHOOL.test(part);

const FILLER = /^(in|of|and|&|the)$/i;
// "B.S.", "BSME", "MBA", "B.A.Sc.", "Ph.D.": a degree's letters.
const ABBREVIATION = /^(?:[A-Z][a-z]?\.){1,4}[A-Za-z]{0,3}\.?$|^[A-Z]{2,5}[a-z]?$/;

/** The words of a degree part the source window has; abbreviations only in a form the source writes. */
function sourceWords(part: string, window: string): string {
  const has = (token: string) => {
    if (ABBREVIATION.test(token)) {
      const letters = token.replace(/\./g, "").split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return new RegExp(`(^|[^A-Za-z])${letters.join("\\.?\\s?")}\\.?(?![A-Za-z])`).test(window);
    }
    return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(window);
  };
  const tokens = part.split(/\s+/).filter((t) => FILLER.test(t) || has(t.replace(/[,;]$/, "")));
  while (tokens.length && FILLER.test(tokens[0])) tokens.shift();
  while (tokens.length && FILLER.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

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
  const kept: string[] = [];
  for (const entry of education.split(/\s*;\s*/).filter(Boolean)) {
    const parts = entry.split(/\s*,\s*/);
    const schoolAt = parts.findIndex((p) => SCHOOL_WORD.test(p));
    const school = schoolAt >= 0 ? parts[schoolAt] : parts[parts.length - 1];
    // No school, no entry: "Self-taught", a bare "BA" (Oct 28: McGowan, Mazzarella).
    if (schoolAt < 0 && !looksLikeSchool(school)) continue;
    const initials = distinctiveWords(school).map((w) => w[0]).join("");
    const window = near.find((w) => namesOrg(w, school) || (initials.length >= 3 && new RegExp(`\\b${initials}\\b`, "i").test(w)));
    if (!window) continue;
    // Degree, field and year as the source words them: an abbreviation the
    // source doesn't use is dropped ("B.A.Sc." for a B.S.), the field it
    // names is kept ("Electrical Engineering").
    const worded = parts.filter((p) => p !== school).map((p) => sourceWords(p, window)).filter(Boolean);
    kept.push([...worded, school].join(", "));
  }
  return kept.length ? kept.join("; ") : undefined;
}

// Words that start a title or a sentence, never a person's name ("its new
// president and CEO of Graybar" once read as a CEO named "its new").
const NOT_A_NAME = /^(president|chief|executive|founder|co-founder|cofounder|chairman|chairwoman|chair|director|officer|ceo|the|its|his|her|their|new|former|interim|acting|and|who|became|named|said|vice|senior|managing|general|today|company|board)$/i;

/** A regex source matching this text in any letter case, spaces flexible. */
function anyCase(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
    .replace(/\s+/g, "\\s+");
}

// A claim about a past CEO ("Former Patagonia CEO Rose Marcario",
// "Marcario, Patagonia's CEO until 2020", "... to step down").
const PAST_BEFORE = /\b(former|ex-|previous|then|outgoing|longtime|late|retired|onetime|one-time|founding)\s*$/i;
const PAST_AFTER = /^[^.;]{0,60}\b(until|stepped down|steps down|step down|stepping down|retired|retires|retire|left|leaves|departed|departs|succeeded by|replaced by|before)\b/i;

/**
 * Someone else the sources name as the organization's current CEO
 * ("Thomas Vozzo, Homeboy's CEO"): the person's own "CEO" title there
 * conflicts. Names are matched case-sensitively, two capitalized words
 * that aren't title words (a case-blind match read "its new" as a CEO).
 * A claim about a past CEO doesn't count (Oct 28: Gellert lost his title
 * to predecessor Rose Marcario), and someone else must be named CEO more
 * often than the person is.
 */
export function otherCeoOf(texts: string[], org: string, personName: string): string | undefined {
  const short = distinctiveWords(org)[0];
  const orgs = [org.replace(/[.,;:]+$/, ""), ...(short && short.length >= 4 ? [short] : [])];
  const ORG = `(?:${orgs.map(anyCase).join("|")})(?:['’]s)?`;
  const NAME = "([A-Z][a-zA-Z’'-]+(?: [A-Z]\\.)? [A-Z][a-zA-Z’'-]+)";
  const CEO = "(?:CEO|[Cc]hief [Ee]xecutive(?: [Oo]fficer)?)";
  const patterns = [
    new RegExp(`${NAME},? (?:the |its )?(?:[Pp]resident and )?${CEO} (?:of|at) ${ORG}`, "g"),
    new RegExp(`${ORG} (?:[Pp]resident and )?${CEO},? ${NAME}`, "g"),
    new RegExp(`${NAME}, ${ORG} ${CEO}`, "g"),
  ];
  const own = words(personName);
  let ownClaims = 0;
  const others = new Map<string, number>();
  for (const t of texts) for (const re of patterns) for (const m of t.matchAll(re)) {
    const name = m[1];
    const parts = name.split(/\s+/);
    if (parts.some((w) => NOT_A_NAME.test(w.replace(/[’'.,]/g, "")))) continue;
    const before = t.slice(Math.max(0, m.index! - 30), m.index!);
    const after = t.slice(m.index! + m[0].length);
    if (PAST_BEFORE.test(before) || PAST_AFTER.test(after)) continue;
    if (parts.some((w) => own.has(normalizeWords(w).trim()))) ownClaims++;
    else others.set(name, (others.get(name) ?? 0) + 1);
  }
  const [name, count] = [...others].sort((a, b) => b[1] - a[1])[0] ?? [];
  return name && count! > ownClaims ? name : undefined;
}

/**
 * The person's title and career once extraction is done (Oct 28): a CEO
 * title is dropped only where someone else is named the current CEO (a
 * past CEO role keeps it), the fullest title the sources give wins, and
 * the current role leads the career history with its start date.
 */
/** A model's text without control characters (Oct 29: "\u001d" inside Mazzarella's title). */
export function stripControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

// A model's placeholder for a title it didn't find ("Role at i.TV").
const PLACEHOLDER_TITLE = /^(role|position|title|job|employee|staff|member|n\/a|na|unknown|various|not specified|unspecified)$/i;

/**
 * Career rows without placeholder titles, one row per title and company
 * (Oct 28: "Role at i.TV"; Boyle's duplicate Founder rows). Of two rows for
 * one role, the one with more dates stays.
 */
export function cleanCareer(careerHistory: CareerEntry[]): CareerEntry[] {
  const out: CareerEntry[] = [];
  for (const raw of careerHistory) {
    const c = { ...raw, title: stripControl(raw.title), ...(raw.company ? { company: stripControl(raw.company) } : {}) };
    if (!c.title || PLACEHOLDER_TITLE.test(c.title)) continue;
    const key = (x: CareerEntry) => [...titleWords(x.title)].sort().join(" ");
    const i = out.findIndex((o) => key(o) === key(c) && (sameOrg(o.company, c.company) || (!o.company && !c.company)));
    const dates = (x: CareerEntry) => (x.start ? 1 : 0) + (x.end ? 1 : 0);
    if (i < 0) out.push({ ...c });
    else if (dates(c) > dates(out[i])) out[i] = { ...c };
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Oct 2026", "Mar 29, 2023", "2023" as a sortable number; undefined without a year. */
export function startValue(date: string | undefined): number | undefined {
  const year = date?.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return undefined;
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}`, "i").test(date!));
  const day = Number(date!.replace(year, "").match(/\b([0-2]?\d|3[01])\b/)?.[1] ?? 0);
  return Number(year) * 400 + (month + 1) * 32 + day;
}

/**
 * The newest of two or more open roles at the current company is the
 * current role (Oct 28: Darway's "President, since Oct 2026" lost to "EVP,
 * Construction, since 2023"). The older role ends when the newer starts,
 * unless the newer title holds it (Mazzarella's Chairman, President and CEO).
 */
// A date stated as a start or an end, not an article's publication date.
const START_BEFORE = /\b(since|joined|joins|named|appointed|became|become|becomes|elected|promoted|took over|takes over|assumed|began|begins|started|starts|effective|hired|founded|co-founded|cofounded|launched)\b[^.;]{0,50}$|\b(?:in|from)\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?)?$/i;
const START_AFTER = /^\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|today|now)\b|^[^.;]{0,15}\b(?:she|he|they|was|were|is)\b[^.;]{0,15}\b(named|appointed|became|elected|promoted|joined|hired)\b/i;
const END_BEFORE = /(?:\b(?:19|20)\d{2}\s*(?:[-–—]|to)\s*|\b(until|through|stepped down|steps down|left|retired|departed|resigned|ended|before)\b[^.;]{0,50})$/i;

/** The year appears near the person's name, worded as a start or an end. */
function stated(date: string, texts: string[], personName: string, kind: "start" | "end"): boolean {
  const year = date.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return false;
  const last = surnameOf(personName);
  for (const t of texts) {
    for (const m of t.matchAll(new RegExp(`\\b${last}\\b`, "gi"))) {
      const w = t.slice(Math.max(0, m.index! - 700), m.index! + 700);
      for (const y of w.matchAll(new RegExp(`\\b${year}\\b`, "g"))) {
        const before = w.slice(Math.max(0, y.index! - 70), y.index!);
        const after = w.slice(y.index! + 4, y.index! + 60);
        if (kind === "start" ? START_BEFORE.test(before) || START_AFTER.test(after) : END_BEFORE.test(before)) return true;
      }
    }
  }
  return false;
}

/**
 * Role dates only as the sources state them (Oct 28: a 2026 article using
 * Mazzarella's full title became a "Chairman, President & CEO, since 2026"
 * row that closed her 2012 role). A start must be worded as one ("since",
 * "joined", "named ... in", "effective"), an end as one ("until", "stepped
 * down", "2012–2014"); a year that's only an article's date is dropped.
 */
export function statedDates(careerHistory: CareerEntry[], texts: string[], personName: string): { careerHistory: CareerEntry[]; notes: string[] } {
  const notes: string[] = [];
  const out = careerHistory.map((c) => {
    const next = { ...c };
    if (c.start && !stated(c.start, texts, personName, "start")) {
      delete next.start;
      notes.push(`${c.title}, ${c.company ?? "?"}: start "${c.start}" not stated as a start in any source, dropped`);
    }
    if (c.end && !stated(c.end, texts, personName, "end")) {
      delete next.end;
      notes.push(`${c.title}, ${c.company ?? "?"}: end "${c.end}" not stated as an end in any source, dropped`);
    }
    return next;
  });
  return { careerHistory: out, notes };
}

export function promoteNewestRole(person: PersonProfile, careerHistory: CareerEntry[]): string | undefined {
  const company = person.currentCompany;
  if (!company) return undefined;
  const open = careerHistory.filter((c) => sameOrg(c.company, company) && !c.end && c.current !== false
    && !BOARD_TITLE.test(c.title) && startValue(c.start) !== undefined);
  if (open.length === 0) return undefined;
  const newest = open.reduce((a, b) => (startValue(b.start)! > startValue(a.start)! ? b : a));
  const role = person.currentRole;
  if (role && covers(role, newest.title)) return undefined;
  const own = role ? careerHistory.find((c) => sameOrg(c.company, company) && c.title.toLowerCase() === role.toLowerCase()) : undefined;
  const ownStart = startValue(own?.start);
  // Only a role known to be older gives way: one with no dated row may be the newest.
  if (role && (ownStart === undefined || ownStart >= startValue(newest.start)!)) return undefined;
  for (const c of open) {
    if (c === newest || covers(newest.title, c.title)) continue;
    c.end = newest.start;
    c.current = false;
  }
  person.currentRole = newest.title;
  return `current role "${role ?? "none"}" -> "${newest.title}", the newest open role at ${company} (since ${newest.start})`;
}

export function settleTitles(
  person: PersonProfile,
  careerHistory: CareerEntry[],
  orgs: string[],
  texts: { snippets: string[]; summary?: string; dated?: string[] },
): { careerHistory: CareerEntry[]; officerConflicts: { org: string; ceo: string }[]; notes: string[] } {
  const notes: string[] = [];
  const officerConflicts: { org: string; ceo: string }[] = [];
  if (person.currentRole) person.currentRole = stripControl(person.currentRole) || undefined;
  if (person.currentCompany) person.currentCompany = stripControl(person.currentCompany) || undefined;
  let career = cleanCareer(careerHistory);
  if (texts.dated) {
    const checked = statedDates(career, texts.dated, person.name);
    career = checked.careerHistory;
    notes.push(...checked.notes);
  }
  for (const o of new Set(orgs)) {
    const ceo = otherCeoOf(texts.snippets, o, person.name);
    if (!ceo) continue;
    officerConflicts.push({ org: o, ceo });
    const at = (c: string | undefined) => sameOrg(c, o);
    career = career.flatMap((c) => {
      if (!at(c.company) || c.end || c.current === false || withoutCeo(c.title) === c.title) return [c];
      const title = withoutCeo(c.title);
      return title ? [{ ...c, title }] : [];
    });
    if (at(person.currentCompany) && person.currentRole && withoutCeo(person.currentRole) !== person.currentRole) {
      person.currentRole = withoutCeo(person.currentRole) || undefined;
    }
    notes.push(`${ceo} is named as ${o}'s CEO; dropped the CEO title there`);
  }
  const newest = promoteNewestRole(person, career);
  if (newest) notes.push(newest);
  const conflictHere = officerConflicts.some((c) => sameOrg(c.org, person.currentCompany));
  const fuller = fullerTitle(person, career, [texts.summary ?? "", ...texts.snippets], conflictHere);
  if (fuller) notes.push(fuller);
  notes.push(...closeSuperseded(person, career));
  return { careerHistory: orderCareer(person, career), officerConflicts, notes };
}

/** "Founder and CEO" -> "Founder" when another person is the CEO; "" when nothing is left. */
export function withoutCeo(title: string): string {
  return title.replace(/\s*(?:,|and|&)?\s*\b(?:CEO|chief executive(?: officer)?)\b\s*(?:,|and|&)?\s*/gi, " ")
    .replace(/\s+/g, " ").replace(/^(and|&|,)\s+|\s+(and|&|,)$/gi, "").trim();
}

const ROLE_TOKEN = "(?:[A-Z][\\w’'-]*|founder|co-founder|cofounder|chairman|chairwoman|chair|president|chief|executive|operating|financial|technology|officer|director|managing|partner|owner|vice|senior|ceo|coo|cfo|cto|and|&)";
const TITLE_WORD = /\b(chair\w*|president|ceo|coo|cfo|cto|chief|founder|co-founder|cofounder|director|officer|executive|partner|owner)\b/i;
// One word per office, so "Executive Vice President" never holds "President" (Oct 28: Darway).
const OFFICES: [RegExp, string][] = [
  [/\bexecutive vice president\b/g, "evp"], [/\bsenior vice president\b/g, "svp"], [/\bvice president\b/g, "vp"],
  [/\bchief executive officer\b|\bchief executive\b/g, "ceo"], [/\bchief operating officer\b/g, "coo"],
  [/\bchief financial officer\b/g, "cfo"], [/\bchief technology officer\b/g, "cto"],
  [/\bvice chair(man|woman|person)?\b/g, "vicechair"], [/\bco-?founder\b/g, "cofounder"],
];
const titleWords = (t: string) => {
  let x = normalizeWords(t.replace(/&/g, " and ").replace(/co-founder/gi, "cofounder")).trim();
  for (const [re, w] of OFFICES) x = x.replace(re, w);
  return new Set(x.split(" ").filter((w) => w && w !== "and" && w !== "of" && w !== "the"));
};
const covers = (big: string, small: string) => [...titleWords(small)].every((w) => titleWords(big).has(w));
const titleCase = (t: string) => t.replace(/\b([a-z])([\w’'-]*)/g, (m, a: string, b: string) => (/^(and|of|the)$/.test(m) ? m : a.toUpperCase() + b));

/**
 * The fullest current title the sources give (Oct 28: Boyle's role read
 * "Executive Director" while his summary says founder and executive
 * director of Homeboy Industries). A longer title at the same company
 * that holds every word of the current one wins, from the career history
 * or from text naming the title "of"/"at" the company. A CEO title is
 * never brought back where someone else is named CEO.
 */
export function fullerTitle(person: PersonProfile, careerHistory: CareerEntry[], texts: string[], ceoConflict = false): string | undefined {
  const role = person.currentRole;
  const company = person.currentCompany;
  if (!role || !company) return undefined;
  const short = distinctiveWords(company)[0];
  const at = new RegExp(`(${ROLE_TOKEN}(?:,?\\s+${ROLE_TOKEN}){0,8})\\s+(?:of|at)\\s+(?:the\\s+)?(?:${[company, ...(short ? [short] : [])].map(anyCase).join("|")})\\b`, "g");
  const nameWords = titleWords(person.name);
  const fromText = texts.flatMap((t) => [...t.matchAll(at)].map((m) => {
    const toks = m[1].split(/\s+/);
    // Drop the person's name and anything before the first title word.
    while (toks.length && (nameWords.has(normalizeWords(toks[0]).trim()) || !TITLE_WORD.test(toks[0]))) toks.shift();
    return titleCase(toks.join(" ").replace(/,$/, ""));
  }));
  const fromCareer = careerHistory.filter((c) => sameOrg(c.company, company) && !c.end && c.current !== false).map((c) => c.title);
  const conflicts = (t: string) => ceoConflict && /\b(ceo|chief executive)\b/i.test(t);
  const best = [...fromCareer, ...fromText]
    .filter((t) => t && TITLE_WORD.test(t) && !conflicts(t) && covers(t, role) && titleWords(t).size > titleWords(role).size && titleWords(t).size <= 8)
    .sort((a, b) => titleWords(b).size - titleWords(a).size)[0];
  if (!best) return undefined;
  const was = role;
  person.currentRole = best;
  return `current title "${was}" -> "${best}"`;
}

// Board wording in a title at the person's own company: "Chairman of Graybar board of directors" is "Chairman".
const BOARD_WORDS = new Set(["board", "directors"]);

/** The current title holds this row's role at the same company, read without the company's name or board wording. */
function heldBy(role: string, title: string, company: string | undefined): boolean {
  const own = company ? titleWords(company) : new Set<string>();
  const core = [...titleWords(title)].filter((w) => !BOARD_WORDS.has(w) && !own.has(w));
  const big = titleWords(role);
  return core.length > 0 && core.every((w) => big.has(w));
}

const FOUNDER = /\b(co-?)?founder\b/i;

/**
 * A role ends when a newer one at the same company starts (Oct 29: Darway's
 * "EVP, Construction, 2023 – end date not stated" ended in Oct 2026 when he
 * became President, his "EVP, Corporate Operations" in 2023). Never a role
 * the current title holds, one the newer title holds, a board seat or a
 * founding, and never across a gap of more than five years: roles the
 * sources don't list may lie between (Mazzarella's 1980 customer service
 * job didn't last until she became CEO in 2012).
 */
export function closeSuperseded(person: PersonProfile, career: CareerEntry[]): string[] {
  const notes: string[] = [];
  for (const c of career) {
    const start = startValue(c.start);
    if (c.end || start === undefined || BOARD_TITLE.test(c.title) || FOUNDER.test(c.title)) continue;
    if (person.currentRole && sameOrg(c.company, person.currentCompany) && heldBy(person.currentRole, c.title, c.company)) continue;
    const next = career
      .filter((n) => n !== c && sameOrg(n.company, c.company) && !BOARD_TITLE.test(n.title) && (startValue(n.start) ?? 0) > start && !covers(n.title, c.title))
      .sort((a, b) => startValue(a.start)! - startValue(b.start)!)[0];
    if (!next || Math.floor(startValue(next.start)! / 400) - Math.floor(start / 400) > 5) continue;
    c.end = next.start;
    c.current = false;
    notes.push(`${c.title}, ${c.company}: ended ${next.start}, when ${next.title} began`);
  }
  return notes;
}

/**
 * Career history with the current role first, dated as its sources date it
 * (Oct 28). Roles at the same company that the current title holds
 * ("CEO" since 2012 within "Chairman, President and CEO") stay current;
 * every other role without an end date is past, never "since 2012" alone
 * (Gellert: Black Diamond's "President (since 2012)" read as current),
 * except a seat on another board a source says they still hold.
 */
export function orderCareer(person: PersonProfile, careerHistory: CareerEntry[]): CareerEntry[] {
  const role = person.currentRole;
  if (!role) return careerHistory;
  const same = (c: CareerEntry) => sameOrg(c.company, person.currentCompany) || (!c.company && !person.currentCompany);
  // The current role's own row, "&" or "and": its start is the role's
  // start. A composite title ("Chairman, President and CEO") with no row of
  // its own borrows no date: its parts keep theirs (Mazzarella: President
  // and CEO since Jun 2012, Chairman since Jan 2013).
  const sameTitle = (a: string, b: string) => covers(a, b) && covers(b, a);
  const exact = careerHistory.findIndex((c) => same(c) && sameTitle(c.title, role));
  const single = careerHistory.filter((c) => same(c) && !c.end && covers(role, c.title) && !!c.start);
  let match = exact >= 0 ? careerHistory[exact] : single.length === 1 && sameTitle(single[0].title, role) ? single[0] : undefined;
  // The combined title's row dated after parts it holds: that's when it was
  // reported, not when it began (Oct 28: Mazzarella "since 2026").
  const parts = careerHistory.filter((c, j) => j !== exact && same(c) && !c.end && covers(role, c.title) && !sameTitle(c.title, role) && startValue(c.start) !== undefined);
  if (match?.start && parts.some((c) => startValue(c.start)! < startValue(match!.start)!)) match = { ...match, start: undefined };
  const first: CareerEntry = {
    title: role,
    ...(person.currentCompany ?? match?.company ? { company: person.currentCompany ?? match?.company } : {}),
    ...(match?.start ? { start: match.start } : {}),
    current: true,
  };
  const rest = careerHistory.filter((_, j) => j !== exact).map((c): CareerEntry => {
    if (c.end) return c;
    // Part of the current title: still held, whatever the model guessed
    // (Oct 29: "Chairman of Graybar board of directors" read as a past role).
    if (same(c) && heldBy(role, c.title, c.company ?? person.currentCompany)) return { ...c, current: true };
    if (c.current === true && BOARD_TITLE.test(c.title) && !same(c)) return c;
    return { ...c, current: false };
  });
  return [first, ...rest];
}

/** Dated within the last two years (Oct 28: a Dec 2011 story in Mazzarella's Recent News). */
export function recentEnough(date: string | undefined, now = new Date()): boolean {
  const t = Date.parse(date ?? "");
  return !isNaN(t) && now.getTime() - t <= 2 * 365 * 86_400_000 + 86_400_000;
}

/**
 * An affiliation row's dates, with what the career history knows (Oct 28:
 * Black Diamond's officer record said "since 2012" while the career
 * history has President 2012-2014). The row's own end date wins, then the
 * career entry's; a role the career history marks past never reads as
 * "since" alone.
 */
export function affiliationDates(org: string, position: string | undefined, start: string | undefined, end: string | undefined, careerHistory: CareerEntry[]): string | undefined {
  const atOrg = careerHistory.filter((c) => sameOrg(c.company, org));
  const c = atOrg.find((x) => !!position && (covers(x.title, position) || covers(position, x.title))) ?? (atOrg.length === 1 ? atOrg[0] : undefined);
  return roleDates({
    start: start ?? c?.start,
    end: end ?? c?.end,
    current: end || c?.end ? false : c?.current,
  });
}

const DEGREE = "(?:honorary doctorate|(?:bachelor|master)['’]?s?(?: degree)?|doctorate|doctoral degree|B\\.?A\\.?(?:Sc\\.?)?|B\\.?S\\.?(?:E\\.?|M\\.?E\\.?|E\\.?E\\.?)?|M\\.?A\\.?|M\\.?S\\.?|M\\.?B\\.?A\\.?|M\\.?Div\\.?|J\\.?D\\.?|Ph\\.?\\s?D\\.?|Ed\\.?D\\.?|LL\\.?M\\.?)";
const FIELD = "(?:\\s+(?:in|of)\\s+([A-Za-z][\\w-]*(?:\\s+(?!from\\b|at\\b|with\\b)(?:[A-Za-z][\\w-]*|and|&)){0,4}))?";
const SCHOOL = "((?:the\\s+)?(?:[A-Z][\\w.'’&-]*\\s+){0,5}(?:University|College|Institute|Seminary|Academy|Polytechnic|School of [A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)(?:\\s+of\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})?)";

/**
 * Degrees read straight from text naming the person, near their name
 * ("a B.S. in Electrical Engineering from Grove City College", "M.Div.
 * from Weston Jesuit School of Theology"): the same every run, where the
 * model's answer wasn't (Oct 28: Gellert's section came and went, Boyle
 * lost Gonzaga and Weston).
 */
export function educationFrom(texts: string[], personName: string): string | undefined {
  const last = surnameOf(personName);
  const found: string[] = [];
  const degreeFirst = new RegExp(`\\b(${DEGREE})${FIELD},?\\s+(?:degree\\s+)?(?:from|at)\\s+${SCHOOL}`, "g");
  const schoolFirst = new RegExp(`\\bgraduated?\\s+(?:from\\s+)?${SCHOOL}(?:\\s+with\\s+(?:a\\s+|an\\s+)?(${DEGREE})${FIELD})?`, "g");
  for (const t of texts) {
    for (const m of t.matchAll(new RegExp(`\\b${last}\\b`, "gi"))) {
      const w = t.slice(Math.max(0, m.index! - 600), m.index! + 800);
      for (const d of w.matchAll(degreeFirst)) found.push(entryOf(d[1], d[2], d[3]));
      for (const d of w.matchAll(schoolFirst)) found.push(entryOf(d[2], d[3], d[1]));
    }
  }
  return mergeEducation(found.join("; "), undefined);
}

function entryOf(degree: string | undefined, field: string | undefined, school: string): string {
  const deg = degree?.replace(/^(a|an)\s+/i, "").trim();
  const d = deg ? deg[0].toUpperCase() + deg.slice(1) : "";
  const f = field?.replace(/\s+(and|&)$/i, "").trim();
  const sch = school.replace(/^the\s+/i, "").replace(/[.,]+$/, "").trim();
  return [d && f ? `${d} in ${f}` : d || (f ?? ""), sch].filter(Boolean).join(", ");
}

/**
 * Two education lines as one, one entry per school: the entry with more
 * to it (degree and field) wins (Oct 28: "keep every degree a source
 * names, with school and major").
 */
export function mergeEducation(a: string | undefined, b: string | undefined): string | undefined {
  const entries = [a, b].flatMap((x) => (x ? x.split(/\s*;\s*/) : [])).map((e) => e.trim()).filter(Boolean);
  const schoolOf = (e: string) => e.split(/\s*,\s*/).find((p) => SCHOOL_WORD.test(p)) ?? e.split(/\s*,\s*/).pop()!;
  const out: string[] = [];
  for (const e of entries) {
    const i = out.findIndex((o) => {
      const so = schoolOf(o), se = schoolOf(e);
      if (!(namesOrg(so, se) || namesOrg(se, so))) return false;
      // Two degrees from one school are two entries.
      const dego = o.split(/\s*,\s*/)[0].toLowerCase(), dege = e.split(/\s*,\s*/)[0].toLowerCase();
      return dego === so.toLowerCase() || dege === se.toLowerCase() || dego.slice(0, 3) === dege.slice(0, 3);
    });
    if (i < 0) out.push(e);
    else if (e.length > out[i].length) out[i] = e;
  }
  return out.length ? out.join("; ") : undefined;
}

/** A site's home page ("crumbl.com/"): not a news item (Oct 28: McGowan). */
export function isHomepage(url: string): boolean {
  try {
    return /^\/(?:index\.html?|home\/?|[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A degree's level from the entry's first part; undefined when it names none. */
function degreeLevel(entry: string): string | undefined {
  const d = entry.split(/\s*,\s*/)[0];
  if (/\b(doctor\w*|Ph\.?\s?D|Ed\.?D|J\.?D)\b/i.test(d)) return "doctorate";
  if (/\b(master\w*|M\.?B\.?A|M\.?S|M\.?A|M\.?Div|LL\.?M)\b/i.test(d)) return "master";
  if (/\b(bachelor\w*|B\.?S\.?\w*|B\.?A\.?\w*)\b/i.test(d)) return "bachelor";
  return undefined;
}

/**
 * Education only from text naming the person and the picked organization,
 * or an employer such text names alongside it (Oct 29: a namesake's
 * "electrical engineering, University of Louisiana at Lafayette" on
 * Darway, whose ACCO board release says B.S. Mechanical Engineering, Cal
 * Poly). What the organization says itself (its site, its press releases,
 * a board page, an SEC filing) wins; another source adds only a degree of
 * a level the official word doesn't give.
 */
export function educationFor(
  extracted: string | undefined,
  texts: (TiedText & { vouched?: boolean })[],
  personName: string,
  org: string | undefined,
  employers: string[],
): string | undefined {
  const named = texts.filter((t) => mentionsPerson(t.text, personName));
  const orgTied = org ? named.filter((t) => tiedToOrg(t.text, personName, org)) : [];
  // An employer counts only when text tied to the picked organization names it too.
  const anchors = org ? [org, ...employers.filter((e) => orgTied.some((t) => namesOrgLoose(t.text, e)))] : employers;
  const eligible = anchors.length ? named.filter((t) => anchors.some((a) => tiedToOrg(t.text, personName, a))) : named;
  const read = (ts: TiedText[]) => {
    const plain = ts.map((t) => t.text);
    return mergeEducation(extracted ? verifyEducation(extracted, plain, personName) : undefined, educationFrom(plain, personName));
  };
  const official = eligible.filter((t) => {
    const host = hostOf(t.url);
    return t.vouched || (!!host && !!org && (orgSite(host, org) || WIRE_HOST.test(host)));
  });
  const fromOfficial = official.length ? read(official) : undefined;
  const all = read(eligible);
  if (!fromOfficial) return all;
  const have = fromOfficial.split(/\s*;\s*/);
  const levels = new Set(have.map(degreeLevel));
  const extra = (all ?? "").split(/\s*;\s*/).filter((e) => {
    const level = degreeLevel(e);
    return !!e && !!level && !levels.has(level);
  });
  return mergeEducation(fromOfficial, extra.join("; ") || undefined);
}

// An organization's name as written: capitalized words, with "&", "of" and "for" inside.
const ORG_RUN = "((?:The\\s+)?[A-Z][\\w&'’.-]*(?:\\s+(?:&|of|for|the|[A-Z][\\w&'’.-]*)){0,7})";
const SEAT_LIST = /\b(?:serves?|served|serving|sits?|sat)\s+(?:also\s+)?on\s+the\s+[Bb]oards?(?:\s+of\s+[Dd]irectors)?\s+(?:of|for|at)\s+([^.;]{3,240})/g;
const SEAT_CHAIR = new RegExp(`\\b((?:[Nn]on-?[Ee]xecutive\\s+|[Ii]ndependent\\s+)?[Cc]hair(?:man|woman|person)?)(?:\\s+of\\s+the\\s+[Bb]oard)?(?:\\s+of\\s+[Dd]irectors)?\\s+(?:of|at)\\s+(?:the\\s+)?${ORG_RUN}`, "g");
const NOT_AN_ORG = /^(The|Board|Directors?|Trustees?|Companies|Several|Various)$/;
const orgName = (raw: string) => raw.replace(/\s+(?:of|for|the|&)$/i, "").replace(/[.,]+$/, "").trim();

/**
 * Board seats as the text says them, in sentences about the person ("She
 * serves on the boards of The Cigna Group, Core & Main and WM (non-
 * executive chair)", "named 2026 chair of the National Association of
 * Wholesaler-Distributors"): the same every run, where the model's list
 * wasn't (Oct 29: Mazzarella's WM, Cigna, Core & Main and NAW all missing).
 * Each still needs a vouching source (confirmBoardSeats).
 */
export function boardsNamed(texts: string[], personName: string): BoardSeatEntry[] {
  const last = surnameOf(personName);
  const out: BoardSeatEntry[] = [];
  const add = (organization: string, role: string) => {
    const o = orgName(organization);
    if (o.length < 2 || NOT_AN_ORG.test(o) || mentionsPerson(o, personName)) return;
    if (!out.some((x) => namesOrgLoose(x.organization, o) || namesOrgLoose(o, x.organization))) out.push({ organization: o, role });
  };
  for (const t of texts) {
    for (const sentence of t.split(/(?<=[.;!?])\s+/)) {
      if (!new RegExp(`\\b${last}\\b`, "i").test(normalizeWords(sentence)) && !/^(She|He|They)\b/.test(sentence)) continue;
      for (const m of sentence.matchAll(SEAT_LIST)) {
        for (const item of m[1].matchAll(new RegExp(`${ORG_RUN}(?:\\s*\\(([^)]*)\\))?`, "g"))) {
          const note = item[2]?.trim();
          add(item[1], note && /chair|director|trustee/i.test(note) ? note : "Director");
        }
      }
      for (const m of sentence.matchAll(SEAT_CHAIR)) add(m[2], m[1].trim());
    }
  }
  return out;
}

/**
 * A board page on an organization's own site is a seat on its board
 * ("Kathleen M. Mazzarella - Board of Directors - The Cigna Group" on
 * thecignagroup.com), named as the page's title names it.
 */
export function seatsFromBoardPages(pages: { url: string; title: string }[], personName: string): BoardSeatEntry[] {
  return pages.flatMap((p) => {
    const host = hostOf(p.url);
    const org = host ? p.title.split(/\s+[-–—|:·]\s+/).map((s) => s.trim())
      .find((s) => s && !BOARD_WORD.test(s) && !mentionsPerson(s, personName) && orgSite(host, s)) : undefined;
    return org ? [{ organization: org, role: "Director" }] : [];
  });
}
