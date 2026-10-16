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
