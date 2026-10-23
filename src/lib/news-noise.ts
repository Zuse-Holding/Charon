/**
 * "Recent News" filter shared by product-agent and people-agent: drops
 * results that match a "<name> news <year>" search but aren't news.
 */

// Social, video and forum hosts: discussion, not news.
const NEWS_NOISE_HOSTS = [
  "youtube.com", "youtu.be", "facebook.com", "instagram.com", "tiktok.com",
  "twitter.com", "x.com", "reddit.com", "pinterest.com", "quora.com",
];
// Template galleries, help centers, docs, and tag/archive index pages
// (e.g. a celebrity site's /tags/<name>/ page) aren't articles either.
const NEWS_NOISE_PATH = /\/(templates?|help|support|docs|tags?|archives?)(\/|$)/i;
// Same idea as a subdomain: support.apple.com, forums.macrumors.com.
const NEWS_NOISE_SUBDOMAIN = /^(support|help|docs|forums?|community|discussions)\./i;

export function isNewsNoise(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return NEWS_NOISE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
      || NEWS_NOISE_SUBDOMAIN.test(host)
      || NEWS_NOISE_PATH.test(u.pathname);
  } catch {
    return true;
  }
}

// Newsroom and blog landing pages (stripe.com/newsroom/news, /press,
// /blog): a list of other articles, not an article. Their extracted text
// is page chrome and a run of bare dates.
const NEWS_INDEX_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(news(room)?|press(-releases)?|blog|media|insights|updates)(\/(news|press|all|latest))?\/?$/i;

export function isNewsIndexPage(url: string): boolean {
  try {
    return NEWS_INDEX_PATH.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

/** "www.axios.com" -> "axios.com". */
export function outletFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Best-effort publish date as "Aug 19, 2026": the search engine's own
 * date first, then a /YYYY/MM/DD/ path. Relative dates ("3 days ago")
 * are resolved against `now`. Undefined when neither gives one, rather
 * than a guess.
 */
export function newsDate(searchDate: string | undefined, url: string, now = new Date()): string | undefined {
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (searchDate) {
    const rel = searchDate.match(/^(\d+)\s+(hour|day|week|month)s?\s+ago$/i);
    if (rel) {
      const n = Number(rel[1]);
      const unitMs = { hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9 }[rel[2].toLowerCase() as "hour"];
      return fmt(new Date(now.getTime() - n * unitMs));
    }
    const parsed = new Date(`${searchDate} UTC`);
    if (!isNaN(parsed.getTime())) return fmt(parsed);
  }
  try {
    const m = new URL(url).pathname.match(/\/(20\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(\/|$)/);
    if (m) return fmt(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  } catch { /* fall through */ }
  return undefined;
}

// A bare date ("February 6, 2026", "Feb 6 2026", "2026-02-06", "02/06/2026").
const DATE_ONLY = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;

/** A real headline: not a bare date and at least three words. A search
 *  result's title is already the page's title tag, so there's nothing
 *  better to fall back to; an item without one is dropped. */
export function isUsableHeadline(title: string | undefined): boolean {
  const t = (title ?? "").trim();
  return t.length > 0 && !DATE_ONLY.test(t) && t.split(/\s+/).length >= 3;
}

/** Lowercase words with apostrophes and "&" removed, so "Foster's" and
 *  "Fosters", "D&D" and "DD" compare equal. */
export function normalizeWords(text: string): string {
  return ` ${text.toLowerCase().replace(/['’&]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const LEGAL_SUFFIX = /\s(?:inc|llc|ltd|corp|corporation|co|company|lp|llp|pc|plc)\s*$/;

// Sentence and title breaks a company's name never spans: "...ORANGE
// JUICE. Equity partners..." doesn't name Juice Equity (round 2, Fix 3).
// A bare dot doesn't break ("Amazon.com", "U.S. Steel" keep working).
const PHRASE_BREAK = /(?<!\b[A-Z])[.!?;:]\s+|[|•·()[\]"“”]|\s[-–—]\s/;

/**
 * The words appear as a name, not a phrase: each starts with a capital
 * ("Juice Equity"), unless the writer used no capitals at all. "ORANGE
 * JUICE equity" is another company's equity, not Juice Equity (round 2,
 * Fix 3).
 */
function namedAsProperNoun(part: string, words: string[]): boolean {
  if (words.length < 2 || !/[A-Z]/.test(part)) return true;
  const raw = part.split(/[^A-Za-z0-9'’&]+/).filter(Boolean);
  const norm = raw.map((t) => normalizeWords(t).trim());
  for (let i = 0; i + words.length <= norm.length; i++) {
    if (words.every((w, j) => norm[i + j] === w) && words.every((_, j) => /^[A-Z0-9]/.test(raw[i + j]))) return true;
  }
  // Tokens that don't line up one-to-one (punctuation inside the name):
  // fall back to the phrase match.
  return !words.every((w) => norm.includes(w));
}

/** The text names this company: its name, legal suffix aside, appears as
 *  a whole phrase within one sentence or title part, written as a name. */
export function mentionsCompany(text: string, companyName: string): boolean {
  const name = normalizeWords(companyName).replace(LEGAL_SUFFIX, " ").trim();
  if (name.length === 0) return false;
  const words = name.split(" ");
  return text.split(PHRASE_BREAK).some((part) => normalizeWords(part).includes(` ${name} `) && namedAsProperNoun(part, words));
}

/** The text names this person: the surname, plus a first name starting
 *  with the same four letters (spelling variants like Saumya/Saumyya). */
export function mentionsPerson(text: string, personName: string): boolean {
  // Possessives name the person too: "Nick Olmos's profile".
  const bare = (t: string) => normalizeWords(t.replace(/['’]s\b/gi, ""));
  const parts = bare(personName).trim().split(" ").filter(Boolean);
  if (parts.length === 0) return false;
  const words = bare(text).trim().split(" ");
  const last = parts[parts.length - 1];
  const firstPrefix = parts[0].slice(0, 4);
  return words.includes(last) && (parts.length === 1 || words.some((w) => w.startsWith(firstPrefix)));
}

/**
 * The short name the press uses (launch fix 36): "Graybar" for Graybar
 * Electric Company, "Crumbl" for Crumbl Cookies, when the website's domain
 * starts with it. Only a distinctive first word (five letters or more).
 */
export function brandName(companyName: string, domain?: string): string | undefined {
  if (!domain) return undefined;
  const label = domain.replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = companyName.trim().split(/\s+/);
  if (words.length < 2) return undefined;
  const first = words[0].replace(/[^A-Za-z0-9]/g, "");
  return first.length >= 5 && label.startsWith(first.toLowerCase()) ? first : undefined;
}


// Gossip outlets and personal-life stories aren't business news (launch
// fix 49: Crumbl's news had a tabloid item about a co-founder's personal life).
const TABLOID_HOSTS = ["dailymail.co.uk", "tmz.com", "pagesix.com", "people.com", "usmagazine.com", "eonline.com", "thesun.co.uk",
  "radaronline.com", "hollywoodlife.com", "intouchweekly.com", "okmagazine.com", "lifeandstylemag.com", "perezhilton.com",
  "thesun.com", "mirror.co.uk", "dailystar.co.uk", "nickiswift.com", "distractify.com", "thelist.com", "celebritynetworth.com"];
const PERSONAL_LIFE = /\b(divorc\w*|wedding|married|marries|engaged|engagement ring|girlfriend|boyfriend|ex-wife|ex-husband|his wife|her husband|dating|romance|affair|cheating|pregnan\w*|baby (boy|girl|news)|gender reveal|mansion|house tour|net worth|plastic surgery|weight loss journey|instagram post|tiktok drama)\b/i;

export function isPersonalLifeNews(headline: string, snippet: string | undefined, url: string | undefined): boolean {
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no host */ }
  if (TABLOID_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return PERSONAL_LIFE.test(`${headline} ${snippet ?? ""}`);
}

// Plaintiff firms announce "investigations" after any share-price drop;
// they're solicitations for clients, not filed suits (launch fix 46:
// Limbach's top risk was one).
const SOLICITING_FIRMS = /\b(rosen law|pomerantz|levi (&|and) korsinsky|bragar eagel|glancy prongay|faruqi|bronstein,? gewirtz|kirby mcinerney|schall law|portnoy law|gross law|johnson fistel|robbins (geller|llp)|kessler topaz|bernstein liebhard|howard g\.? smith|frank r\.? cruz|holzer (&|and) holzer|block (&|and) leviton|hagens berman|rigrodsky|halper sadeh|ademi|monteverde|kahn swick|brodsky (&|and) smith|wohl (&|and) fruchter|lifshitz|bernstein litowitz|the klein law|gainey mckenna|levi korsinsky)\b/i;
const SOLICITATION = /\b(announces? (an )?investigation|investigation (of|into|on behalf of)|investigating (potential |possible )?(securities|claims)|encourages? (investors|shareholders)|reminds? (investors|shareholders)|shareholder alert|investor alert|lead plaintiff deadline|class action (filed|lawsuit) (on behalf of|against)|have you suffered losses|losses? (in|on) .{0,40}(stock|shares))/i;

export function isLawFirmSolicitation(headline: string, snippet?: string): boolean {
  const t = `${headline} ${snippet ?? ""}`;
  return SOLICITATION.test(t) || (SOLICITING_FIRMS.test(t) && /\b(investigat\w*|class action|investors?|shareholders?)\b/i.test(t));
}
