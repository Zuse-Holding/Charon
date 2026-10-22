import { hostOf } from "./entities/subject.js";
import { normalizeWords } from "./news-noise.js";

/**
 * Source quality (launch P0). Every cited page gets a tier from its domain
 * and path, pure code, no model call:
 *
 *   primary    the company's own site, a government or court record
 *   press      an established news outlet or wire service
 *   reference  encyclopedias and company databases
 *   unknown    anything not classified: kept, ranked below the above
 *   directory  scraped people/company directories (RocketReach, Comparably):
 *              kept, but what they alone support is marked low-confidence
 *   marketing  another vendor's "alternatives"/"vs"/blog page, content farms
 *   forum      Reddit, Quora and the like
 *
 * Marketing and forum pages are never cited and never feed extraction.
 */
export type SourceTier = "primary" | "press" | "reference" | "unknown" | "directory" | "marketing" | "forum";

const TIER_SCORE: Record<SourceTier, number> = {
  primary: 1, press: 0.8, reference: 0.6, unknown: 0.5, directory: 0.3, marketing: 0.1, forum: 0,
};

const REGISTRY_HOSTS = [
  "sec.gov", "courtlistener.com", "opencorporates.com", "usaspending.gov", "sam.gov", "nlrb.gov",
  "npiregistry.cms.hhs.gov", "web.archive.org", "trade.gov", "irs.gov", "propublica.org",
  "bizfileonline.sos.ca.gov", "littlesis.org", "fec.gov", "congress.gov", "legiscan.com",
];

const PRESS_HOSTS = [
  "reuters.com", "apnews.com", "bloomberg.com", "wsj.com", "ft.com", "nytimes.com", "washingtonpost.com",
  "cnbc.com", "forbes.com", "fortune.com", "businessinsider.com", "axios.com", "techcrunch.com", "theverge.com",
  "wired.com", "economist.com", "latimes.com", "bizjournals.com", "theinformation.com", "semafor.com",
  "npr.org", "bbc.com", "bbc.co.uk", "theguardian.com", "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "usatoday.com", "politico.com", "barrons.com", "marketwatch.com", "inc.com", "fastcompany.com",
  "paymentsdive.com", "constructiondive.com", "enr.com", "multifamilydive.com", "therealdeal.com",
  "globest.com", "connectcre.com", "costar.com", "commercialobserver.com", "sfchronicle.com",
  "prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com",
];

const REFERENCE_HOSTS = ["wikipedia.org", "crunchbase.com", "pitchbook.com", "dnb.com", "bbb.org", "linkedin.com"];

const DIRECTORY_HOSTS = [
  "rocketreach.co", "zoominfo.com", "comparably.com", "craft.co", "unifygtm.com", "derrick-app.com",
  "signalhire.com", "contactout.com", "apollo.io", "lusha.com", "theorg.com", "leadiq.com", "datanyze.com",
  "clay.com", "cbinsights.com", "owler.com", "growjo.com", "kona-equity.com", "zippia.com", "salesintel.io",
  "adapt.io", "6sense.com", "seamless.ai", "prospeo.io", "getprospect.com", "bizapedia.com", "buzzfile.com",
  "manta.com", "dandb.com", "corporationwiki.com", "opengovus.com", "allbiz.com",
];

const FORUM_HOSTS = [
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "news.ycombinator.com",
  "nextdoor.com", "tiktok.com", "pinterest.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
];

// Content farms and SEO publishers seen citing "competitors" lists.
const CONTENT_FARM_HOSTS = [
  "attrock.com", "chargeflow.io", "demandsage.com", "electroiq.com", "businessofapps.com", "backlinko.com",
  "explodingtopics.com", "zipdo.co", "gitnux.org", "enterpriseappstoday.com",
  "coolest-gadgets.com", "startupbonsai.com", "earthweb.com", "bloggingwizard.com", "financesonline.com",
  "softwaresuggest.com", "capterra.com", "g2.com", "getapp.com", "trustradius.com", "slashdot.org",
  "sourceforge.net", "alternativeto.net", "saasworthy.com", "selecthub.com", "medium.com", "substack.com",
];

// Another business's page about the subject's market: "Stripe alternatives",
// "X vs Y", "top 10 ...", or any vendor blog post.
const MARKETING_PATH = /(?:^|[/_-])(alternatives?|competitors?|vs|versus|compare|comparison|best|top-?\d+|statistics|stats)(?:[/_.-]|$)|\/blog\//i;

function hostIn(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * @param subjectDomain The company's own domain: its pages are primary,
 *   including its blog and comparison pages.
 */
export function sourceTier(url: string, subjectDomain?: string): SourceTier {
  const host = hostOf(url);
  if (!host) return "forum";
  if (subjectDomain && (host === subjectDomain || host.endsWith(`.${subjectDomain}`))) return "primary";
  if (/\.(gov|mil)$/.test(host) || /\.(state|ca|ny|tx|fl|wa)\.us$/.test(host) || hostIn(host, REGISTRY_HOSTS)) return "primary";
  if (hostIn(host, FORUM_HOSTS) || /^(forums?|community|discussions?)\./.test(host)) return "forum";
  if (hostIn(host, CONTENT_FARM_HOSTS)) return "marketing";
  if (hostIn(host, DIRECTORY_HOSTS)) return "directory";
  if (hostIn(host, PRESS_HOSTS)) return "press";
  if (hostIn(host, REFERENCE_HOSTS)) return "reference";
  let path = "";
  try { path = new URL(url).pathname; } catch { /* host parsed, path empty */ }
  if (MARKETING_PATH.test(path)) return "marketing";
  return "unknown";
}

export function sourceScore(url: string, subjectDomain?: string): number {
  return TIER_SCORE[sourceTier(url, subjectDomain)];
}

/** Never cited, never read for facts. */
export function isCitable(url: string, subjectDomain?: string): boolean {
  const tier = sourceTier(url, subjectDomain);
  return tier !== "marketing" && tier !== "forum";
}

/** A fact that rests only on these is shown as low-confidence. */
export function isLowConfidence(url: string | undefined, subjectDomain?: string): boolean {
  return !url || sourceTier(url, subjectDomain) === "directory";
}

/** Citable results, best tier first; search order breaks ties. */
export function rankCitable<T extends { url: string }>(results: T[], subjectDomain?: string): T[] {
  return results
    .map((r, i) => ({ r, i, s: sourceScore(r.url, subjectDomain) }))
    .filter(({ r }) => isCitable(r.url, subjectDomain))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ r }) => r);
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "inc", "llc", "co", "corp", "company", "group", "ltd", "&"]);

/**
 * Claim-to-source check: the page states the claim's name. Every
 * substantive word of `name` appears in `text` (case and punctuation
 * ignored). Lexical on purpose: it never confirms a citation a reader
 * couldn't find on the page.
 */
export function pageSupports(text: string | undefined | null, name: string): boolean {
  if (!text) return false;
  const words = normalizeWords(name).trim().split(" ").filter((w) => w && !STOP.has(w));
  if (words.length === 0) return false;
  const hay = ` ${normalizeWords(text)} `;
  return words.every((w) => hay.includes(` ${w} `));
}
