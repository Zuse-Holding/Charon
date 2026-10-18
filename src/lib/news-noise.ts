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
