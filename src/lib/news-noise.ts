/**
 * "Recent News" filter shared by product-agent and people-agent: drops
 * results that match a "<name> news <year>" search but aren't news.
 */

// Social, video and forum hosts: discussion, not news.
const NEWS_NOISE_HOSTS = [
  "youtube.com", "youtu.be", "facebook.com", "instagram.com", "tiktok.com",
  "twitter.com", "x.com", "reddit.com", "pinterest.com", "quora.com",
  // Reviews and directories (launch fix 77: Promise ABA's only
  // "opportunity" was a Yelp review of a competitor).
  "yelp.com", "tripadvisor.com", "trustpilot.com", "glassdoor.com", "indeed.com", "angi.com", "thumbtack.com",
  "yellowpages.com", "bbb.org", "mapquest.com", "birdeye.com", "nextdoor.com",
  // Company-profile directories ("Careers, Perks + Culture"), not news (launch fix 84).
  "builtin.com", "comparably.com", "zippia.com", "zoominfo.com", "rocketreach.co", "craft.co", "owler.com", "dnb.com", "cbinsights.com",
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

/** A date in the article's address: /2026/09/02/, /2026-10-20/, /20260803cg.... */
function urlDate(url: string): Date | undefined {
  let path = "";
  try { path = new URL(url).pathname; } catch { return undefined; }
  const m = path.match(/\/((?:19|20)\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$)/)
    ?? path.match(/\/(?:[a-z-]*-)?((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?=[/-]|$)/i)
    ?? path.match(/\/((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=[a-z]|\/|$)/i);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : undefined;
}

/**
 * The publish date the article's own page states: its article meta tag or
 * structured data. Undefined when the page doesn't say.
 */
export function publishedDate(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  const head = html.slice(0, 200_000);
  const tags = "article:published_time|og:article:published_time|datePublished|pubdate|publishdate|parsely-pub-date|sailthru\\.date|dc\\.date\\.issued";
  const found = head.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["'](?:${tags})["'][^>]*content=["']([^"']+)["']`, "i"))?.[1]
    ?? head.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:${tags})["']`, "i"))?.[1]
    ?? head.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]
    ?? head.match(/<time[^>]+(?:itemprop=["']datePublished["']|pubdate)[^>]*datetime=["']([^"']+)["']/i)?.[1];
  const t = found ? new Date(found) : undefined;
  return t && !isNaN(t.getTime()) ? `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}` : undefined;
}

/**
 * Best-effort publish date as "Aug 19, 2026": a date in the article's
 * address first, then the search engine's date (round 15: its "5 months
 * ago" put a May 12 story at May 27). Relative dates ("3 days ago") are
 * resolved against `now`. Undefined when neither gives one, rather than a
 * guess. The page's own date (publishedDate) beats both where it was read.
 */
export function newsDate(searchDate: string | undefined, url: string, now = new Date()): string | undefined {
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const inUrl = urlDate(url);
  if (inUrl && inUrl.getTime() <= now.getTime() + 86_400_000) return fmt(inUrl);
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
  return undefined;
}

// A place that shares the company's name (round 15: Patagonia's news led
// with "Patagonia's New 231-Mile Lodge-to-Lodge Trek", and AI data centers
// in glacier-strewn Patagonia).
const PLACE_WORDS = /\b(trek\w*|hik(e|es|ing)|glacier\w*|lodge-to-lodge|itinerar\w+|travel\w*|trips?|tourism|tourists?|cruises?|expeditions?|national park|wildlife|penguins?|whales?|region|province|data cent(er|re)s?|wildfires?|forest fires?|burn(s|ing|ed)?|drought|floods?|earthquakes?|milei|argentin\w*|austerity)\b/i;
const BUSINESS_WORDS = /\b(ceo|founder|company|brand|retailer|maker|apparel|clothing|jackets?|gear|stores?|employees|workers|sues|sued|lawsuit|acquires|acquisition|earnings|revenue|sales?|launch\w*|appoints|names|campaign|donat\w+|repair)\b/i;

/** The headline is about a place named like the company, not the company. */
export function isPlaceNamesake(title: string, snippet: string | undefined, name: string): boolean {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return false;
  // "de la Patagonia", "across Patagonia": the name as a place. Not "in" or
  // "to", which a deal headline uses ("sold to Limbach Holdings").
  const asPlace = new RegExp(`\\b(?:de la|del|across|around|visit\\w*|explor\\w*)\\s+${n}\\b(?!['’]s\\b|,?\\s+inc\\b|\\s+(?:stores?|brand|employees|ceo|founder|workers)\\b)`, "i");
  if (asPlace.test(title)) return true;
  return PLACE_WORDS.test(title) && !BUSINESS_WORDS.test(title) && !BUSINESS_WORDS.test(snippet ?? "");
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
  // A bare "&" is no word (launch fix 79: "Andersen Windows & Doors"
  // never matched itself, so the name found nothing).
  const raw = part.split(/[^A-Za-z0-9'’&]+/).filter((t) => normalizeWords(t).trim());
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
  "thesun.com", "justjared.com", "mirror.co.uk", "dailystar.co.uk", "nickiswift.com", "distractify.com", "thelist.com", "celebritynetworth.com",
  "dailymail.com", "the-sun.com", "inquisitr.com", "bossip.com", "realitytea.com", "starcasm.net", "thethings.com", "suggest.com"];
const PERSONAL_LIFE = /\b(divorc\w*|wedding|married|marries|engaged|engagement ring|girlfriend|boyfriend|ex-wife|ex-husband|his wife|her husband|dating|romance|affair|cheating|pregnan\w*|baby (boy|girl|news)|gender reveal|mansion|house tour|net worth|plastic surgery|weight loss journey|instagram post|tiktok drama|tiktoker|grindr|outed)\b/i;
// Feuds and denials are gossip only when nothing legal or commercial is at
// stake: "Crumbl and Dirty Dough settle trademark feud" and "ACCO denies
// discrimination claims in federal lawsuit" are business news (round 15).
const GOSSIP = /\b(feud\w*|denies [^.]{0,40}claims)\b/i;
const BUSINESS_STAKE = /\b(lawsuits?|suits?|sued|sues|court|trademark|patent|copyright|settle\w*|discriminat\w*|wages?|wage-theft|harass\w*|shareholders?|investors?|franchise\w*|contracts?|regulat\w*|class action|complaints?|filed|federal|eeoc|osha|nlrb|union)\b/i;

export function isPersonalLifeNews(headline: string, snippet: string | undefined, url: string | undefined): boolean {
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no host */ }
  if (TABLOID_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  const text = `${headline} ${snippet ?? ""}`;
  return PERSONAL_LIFE.test(text) || (GOSSIP.test(text) && !BUSINESS_STAKE.test(text));
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

// Words that can follow a company's name in a title-case headline without
// making a longer name: verbs, titles, legal forms.
const AFTER_NAME = new Set(["inc", "llc", "corp", "co", "company", "ltd", "lp", "plc", "holdings", "group", "ceo", "cfo", "coo", "cto",
  "president", "founder", "founders", "co-founder", "chair", "chairman", "board", "raises", "raised", "secures", "closes", "lands",
  "announces", "launches", "names", "appoints", "hires", "taps", "opens", "acquires", "buys", "sells", "sues", "sued", "settles",
  "files", "wins", "expands", "plans", "to", "and", "in", "at", "for", "of", "on", "with", "is", "has", "says", "said", "reports",
  "posts", "cuts", "lays", "closing", "closes", "unveils", "debuts", "partners", "agrees", "completes", "receives", "gets", "faces",
  "stock", "shares", "employees", "workers", "stores", "locations", "jacket", "jackets", "x", "vs", "v", "news", "inc.", "llc."]);
const BEFORE_NAME = /\b(town|city|county|village|lake|port|university|school|district|church|hotel|bank|state) of\s*$|\b(chilean|argentine|argentinian|argentina['’]s|chile['’]s|southern|northern|eastern|western|central)\s*$|\b(health|healthcare|medical|insurance|medicaid|medicare|mutual)\s*$/i;
// "Mountain Health Promise ABA Coverage" names a Medicaid plan, not Promise
// ABA (round 13): a health-plan word right before the name makes a longer name.
// A place, not the company: "Patagonia region", "Patagonia glaciers"
// (launch fix 77: regional data-center news and EPA research on the region).
const PLACE_AFTER = /^\s*(region|regions|province|steppe|ice ?fields?|glaciers?|lakes?|coast|desert|wilderness)\b/i;

/**
 * The text names this organization itself, not a longer name that
 * contains it (launch fix 57: "Patagonia Health raises Series A" is not
 * Patagonia; "Town of Patagonia" is not either). At least one mention
 * must be followed by a lowercase word, punctuation, the end, or a word a
 * headline puts after a company's name.
 */
export function namesItself(text: string, name: string): boolean {
  const core = name.replace(/,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/i, "").trim();
  if (!core) return false;
  const esc = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  for (const m of text.matchAll(new RegExp(`\\b${esc}\\b(['’]s\\b)?`, "gi"))) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (BEFORE_NAME.test(before)) continue;
    if (m[1]) return true;
    const rest = text.slice((m.index ?? 0) + m[0].length);
    if (PLACE_AFTER.test(rest)) continue;
    const next = rest.match(/^\s*([A-Za-z][\w.'’-]*)/)?.[1];
    if (!next || /^[^A-Za-z]*$/.test(rest.slice(0, 2).trim()) || /^[a-z]/.test(next) || AFTER_NAME.has(next.toLowerCase())) return true;
    // "Patagonia, Inc." / "Patagonia:" / "Patagonia —"
    if (/^\s*[,:;—–(-]/.test(rest)) return true;
  }
  return false;
}

// Shopping and deal content (launch fix 61: Patagonia's "news" was sale
// articles), and stock-quote pages (Limbach).
// A store "sale", not the sale of a business ("sale of", "sale to").
const SHOPPING = /\b(on sale|sale:|deals?\b|discount|\d+% off|save \$?\d+|coupon|promo code|best .{0,30} to buy|gift guide|black friday|cyber monday|prime day|review:|reviewed|we tested|clearance|web specials?|markdowns?|sale(?!\s+(of|to)\b|-))\b|\bup to \d+%/i;
const QUOTE_PAGE = /\b(stock (price|quote)|share price|stock forecast|price target|\(NASDAQ:|\(NYSE:)\b/i;
const QUOTE_HOSTS = ["finance.yahoo.com", "marketbeat.com", "stockanalysis.com", "investing.com", "marketwatch.com", "nasdaq.com",
  "zacks.com", "stocktitan.net", "simplywall.st", "macrotrends.net", "tipranks.com", "stockinvest.us", "wallmine.com", "companiesmarketcap.com"];

/** Any page on a stock-quote site (MarketBeat, StockTitan): person reports
 *  keep them out of news whatever the headline (Oct 28 handoff). */
export function isQuoteSite(url: string | undefined): boolean {
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no host */ }
  return QUOTE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** A site's news or media index by its title ("Limbach News Media."), not an article. */
export function isIndexTitle(title: string): boolean {
  const t = title.replace(/\s*[|\-–—]\s*.*$/, "").trim();
  return t.split(/\s+/).length <= 5 && /\b(news|newsroom|media|press|press releases|blog|updates|in the news)\.?$/i.test(t);
}

export function isShoppingOrQuote(headline: string, url: string | undefined): boolean {
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no host */ }
  if (QUOTE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) && QUOTE_PAGE.test(headline)) return true;
  if (/\/(quote|quotes|stock|stocks|symbol)\//i.test(url ?? "") && !/\/news\//i.test(url ?? "")) return true;
  return SHOPPING.test(headline) || STOCK_PITCH.test(headline);
}

// Pre-IPO broker pages and stock pitches, not news (round 14: Gecko's
// "Invest in Series Gecko Robotics (2025 Round)", "Stock: $1.25B — Is It a Buy?").
const STOCK_PITCH = /^\s*invest in\b|\b(is it a buy|buy or sell|should you buy|pre-?ipo (stock|shares|investing)|stock:\s*\$|how to (buy|invest in) \S+ (stock|shares))/i;

// Government enforcement sources (launch fix 62).
const ENFORCEMENT_HOSTS = ["justice.gov", "sec.gov", "ftc.gov", "epa.gov", "osha.gov", "dol.gov", "eeoc.gov", "cfpb.gov", "consumerfinance.gov", "hhs.gov", "oig.hhs.gov", "fda.gov"];

export function isEnforcementSource(url: string | undefined): boolean {
  try {
    const host = url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : "";
    return ENFORCEMENT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// A government page is an enforcement action only when it is one (launch
// fix 76: Graybar's own 10-K, Gecko's Form D, DOJ conference videos and EPA
// research on the Patagonia region were all labeled "enforcement charges").
const COMPANY_FILING_PATH = /\/(Archives\/edgar|cgi-bin\/browse-edgar|edgar)\//i;
const COMPANY_FILING_TITLE = /\b(10-K|10-Q|8-K|S-1(\/A)?|S-4|DEF ?14A|20-F|Form D|annual report|quarterly report|prospectus|proxy statement|registration statement)\b/i;
const ENFORCEMENT_PATH = /\/(litigation|enforcement|enforce|litreleases|admin|complaints|cases|citations?)(\/|-|$)|\/(opa|usao-[a-z]+|usao)\/pr\//i;
const ENFORCEMENT_ACTION = /\b(United States|U\.S\.|SEC|FTC|EEOC|EPA|People|State of [A-Z][a-z]+) v\.\s|\b(charg(e|es|ed|ing)|indict(ed|ment)|plead(s|ed)? guilty|pleaded guilty|sentenced|convicted|settle(s|d|ment)?|consent (order|decree|judgment)|conciliation agreement|complaint against|civil penalt(y|ies)|penalt(y|ies)|fined|agrees? to pay|ordered to pay|to resolve (allegations|claims)|false claims act|litigation release|administrative proceeding|cease[- ]and[- ]desist|cited for|citations? (to|against)|sues|sued|lawsuit against)\b/i;

const OSHA_INSPECTION = /^https?:\/\/(www\.)?osha\.gov\/(ords\/imis\/|pls\/imis\/)?establishment|osha\.gov\/.*inspection_detail/i;

export function isEnforcementAction(r: { title: string; snippet?: string; url: string }, names: string[]): boolean {
  if (!isEnforcementSource(r.url)) return false;
  // Filings by the company belong to Funding or Financials, not risks.
  if (COMPANY_FILING_PATH.test(r.url) || COMPANY_FILING_TITLE.test(r.title)) return false;
  let path = "";
  try { path = new URL(r.url).pathname; } catch { /* no path */ }
  const named = (text: string) => names.some((n) => !!n && mentionsCompany(text, n) && namesItself(text, n));
  // An OSHA inspection record naming the establishment is one (launch fix
  // 78: ACCO lost its three inspections to the stricter check).
  if (OSHA_INSPECTION.test(r.url)) return named(`${r.title} ${r.snippet ?? ""}`);
  const titleAction = ENFORCEMENT_ACTION.test(r.title);
  if (!titleAction && !(ENFORCEMENT_PATH.test(path) && ENFORCEMENT_ACTION.test(r.snippet ?? ""))) return false;
  // The company must be named as itself (a party), not a namesake or a place.
  return named(r.title) || (titleAction && named(r.snippet ?? ""));
}
