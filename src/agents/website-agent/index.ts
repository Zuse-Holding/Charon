import {
  CompanyAnchor,
  CompanyProfile,
  LeadershipEntry,
  ProductEntry,
  Source,
  WebsiteAgentResult,
} from "../../types/research.js";
import {
  FetchProvider,
  FetchedPage,
  PlaceResult,
  SearchProvider,
  SearchResult,
  ResolvedPage,
  resolveAndFetch,
  extractBestChunk,
  fetchPageText,
  htmlToFullText,
} from "../../lib/providers.js";
import { crawlTargets, readSiteRecord, sitemapUrls, type SiteRecord } from "../../lib/entities/site-record.js";

/** A business's own site as read: every page, and what it states. */
interface SiteRead {
  text: string;
  record: SiteRecord;
  url: string;
  pages: { url: string; kind: string; text: string }[];
  /** Read through a render service or the Internet Archive (launch fix 24). */
  via?: "rendered" | "archived";
  /** The domain its contact emails use, when not the website's (launch fix 31). */
  emailDomain?: string;
}
import {
  extractPeopleWithTitles,
  extractProductCandidates,
  cleanProducts,
  isPersonName,
  PRODUCT_STOPWORDS,
} from "../../lib/nlp.js";
import { mentionsCompany, normalizeWords } from "../../lib/news-noise.js";
import { cityOf, detectClosure } from "../../lib/closure.js";
import { hostOf, tiedToSubject } from "../../lib/entities/subject.js";
import { isCitable } from "../../lib/source-quality.js";
import { cleanLeadership, titleNear } from "../../lib/leadership.js";

const FILLER_WORDS = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "by", "with", "our", "&"]);
const wordSet = (t: string) => new Set(normalizeWords(t).trim().split(" "));

/** The first text that contains every word of `name`: where the item came
 *  from. Undefined when no tied source names it. */
function sourceFor(name: string, texts: { words: Set<string>; url: string }[]): string | undefined {
  const words = normalizeWords(name).trim().split(" ").filter((w) => w && !FILLER_WORDS.has(w));
  if (words.length === 0) return undefined;
  return texts.find((t) => words.every((w) => t.words.has(w)))?.url;
}

// A page or listing title, not something the business sells: "Careers At
// MJW", "MJW Crunchbase Company Profile", "Services JPMS Brokerage".
const LINK_TITLE = /\b(careers?|jobs?|hiring|crunchbase|linkedin|zoominfo|profile|login|log in|sign in|contact us|about us|our team|blog|news|press|faq|privacy|terms|sitemap|home ?page|reviews?)\b/i;
const OTHER_FIRM = /\b(brokerage|securities|j\.?\s?p\.?\s?morgan|jpms|morgan stanley|wells fargo|merrill)\b/i;

export function isLinkTitle(name: string, companyName: string): boolean {
  if (LINK_TITLE.test(name)) return true;
  // Another firm's product line, unless the company is that firm.
  return OTHER_FIRM.test(name) && !OTHER_FIRM.test(companyName);
}

// Prompt size for the one extraction call. Groq, the fallback when
// OpenRouter fails, rejects any request over 8K tokens a minute counting
// the 2K-token answer, so the whole prompt stays near 5K tokens (about
// 4 characters each): the site's pages first, then search results.
const SITE_TEXT_BUDGET = 10_000;
const PROMPT_TEXT_BUDGET = 18_000;

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|live|proton(mail)?|example|sentry|wixpress|sentry-next)\./i;

/**
 * The domain a company's own email addresses use, when it isn't the
 * website's (launch fix 31: Crumbl's site is crumblcookies.com, its mail
 * another domain). The most common one across its pages; free webmail,
 * placeholders and image names ("logo@2x.png") don't count.
 */
export function sendingDomain(htmls: string[], website: string): string | undefined {
  let site = "";
  try { site = new URL(website).hostname.replace(/^www\./, "").toLowerCase(); } catch { return undefined; }
  const counts = new Map<string, number>();
  for (const html of htmls) {
    for (const m of html.matchAll(/[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi)) {
      const d = m[1].toLowerCase();
      if (FREE_MAIL.test(d) || /\.(png|jpe?g|gif|svg|webp)$/.test(d) || d === site || d.endsWith(`.${site}`)) continue;
      // The company's own other domain shares its name (crumbl.com and
      // crumblcookies.com); a vendor's or partner's address doesn't.
      const label = d.split(".").slice(-2)[0];
      const siteLabel = site.split(".").slice(-2)[0];
      if (label.length < 4 || !(siteLabel.includes(label) || label.includes(siteLabel))) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best?.[0];
}

const FRANCHISE = /\bfranchis(e|ed|ee|ing)\b/i;

// The extracted description calls the business a chain or franchise.
const CHAIN_DESCRIPTION = /\b(chain|franchis\w*|\d+\+? locations)\b/i;

// A brand site's location finder or franchise pages: a location search
// that lands here is reading the brand, not the location.
const BRAND_SITE = /\b(our locations|all locations|find a (?:store|location|restaurant)|store locator|franchis(?:e|ing) opportunit)/i;
import { CompanyExtractionSchema, extractStructured } from "../../lib/llm.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

// Domains that should never be treated as a company's official website
// even if they rank first in search results for "X official website".
const NON_OFFICIAL_DOMAINS = new Set([
  "wikipedia.org",
  "en.wikipedia.org",
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
  "bloomberg.com",
  "reuters.com",
  "forbes.com",
  "techcrunch.com",
  "reddit.com",
  "yelp.com",
  "glassdoor.com",
  "indeed.com",
  "pitchbook.com",
  "tracxn.com",
]);

/** "19524 Nordhoff St #3B, Northridge, CA 91324" -> "Northridge"; undefined
 *  when the address has no "City, ST" part. */
function listingCity(address: string | undefined): string | undefined {
  const parts = address?.split(",").map((p) => p.trim()) ?? [];
  if (parts.length < 2 || !/\b[A-Z]{2}\b/.test(parts[parts.length - 1])) return undefined;
  return parts[parts.length - 2] || undefined;
}

function isOfficialDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return !NON_OFFICIAL_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// isRejectedDomain moved to src/entity-validation.ts (7/20) — now shared
// across corporate-agent, news-agent, and competitor-agent too, not just
// this file. See that file's doc comment for why.

/**
 * Strips common nav/header noise patterns from raw page text before
 * sending to the LLM. JS-rendered sites often have very little real
 * content in static HTML — what they do have is navigation menus,
 * "Skip to main content" links, language selectors, and JS fragments.
 * Removing these makes the LLM's job meaningfully easier and prevents
 * the Executive Summary from reading like a site map.
 */
function trimToSentence(text: string, maxChars = 500): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastEnd = Math.max(
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf("! "),
    trimmed.lastIndexOf("? ")
  );
  return lastEnd > 100 ? trimmed.slice(0, lastEnd + 1) : trimmed;
}

function cleanPageText(text: string): string {
  return text
    // Remove JS fragments that leak through
    .replace(/\{[^}]{0,200}\}/g, " ")
    // Remove "Skip to X" / "Back to X" nav patterns
    .replace(/\b(Skip to|Back to|Go to|Jump to|Return to)\s+\S+/gi, " ")
    // Remove standalone nav keywords
    .replace(/\b(Sign in|Sign up|Log in|Log out|Contact Us|Translate|Menu|Search|Close|Open)\b/gi, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cleans a leadership name/title field extracted by the LLM or heuristic
 * fallback. Strips stray markdown bold markers and trailing dash
 * fragments that occasionally leak through when a source page's
 * "meet the team" text runs multiple people together (e.g.
 * "**Cassandra Paniagua, M.S., BCBA** —" or "Iknoian** —").
 */
function cleanLeadershipField(value: string): string {
  return value
    .replace(/\*\*/g, "")           // strip markdown bold
    .replace(/\s*—\s*$/, "")        // strip trailing dash fragments
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Website Agent
 * Collects: description, founded/HQ/industry, leadership, products.
 *
 * Sourcing: official site (direct guess -> search fallback) for
 * overview text, plus separate searches for leadership and products
 * (homepages rarely list either in usable form).
 *
 * Extraction: tries a local LLM (Ollama, see lib/llm.ts) first — it
 * reads the combined text and returns structured JSON, which handles
 * cases regex/NLP fundamentally can't (e.g. distinguishing a real
 * product name from marketing copy, writing an actual summary instead
 * of slicing raw text). If Ollama isn't running or the call fails for
 * any reason, falls back automatically to the heuristic extraction
 * (lib/nlp.ts) that was already here — the agent never errors out
 * just because the LLM is unavailable.
 */
/**
 * An inner page's own content: its <main> when it has one, without the
 * header, nav and footer every page repeats, and without any opening run
 * it shares with the homepage text (launch fix 50).
 */
export function pageBody(html: string, homeText: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const body = (main ?? html).replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const text = htmlToFullText(body);
  let i = 0;
  while (i < text.length && i < homeText.length && text[i] === homeText[i]) i++;
  // Only a real shared run (a menu) is cut, back to a word boundary.
  if (i < 200) return text;
  const cut = text.lastIndexOf(" ", i);
  return text.slice(cut > 0 ? cut + 1 : i);
}

/** Equal shares of a budget, with what a short page doesn't use handed to the rest. */
export function budgetShares(lengths: number[], budget: number): number[] {
  const shares = lengths.map(() => 0);
  let left = Math.max(0, budget);
  let open = lengths.map((_, i) => i);
  while (open.length && left > 0) {
    const each = Math.floor(left / open.length);
    if (each === 0) break;
    const next: number[] = [];
    for (const i of open) {
      const take = Math.min(each, lengths[i] - shares[i]);
      shares[i] += take;
      left -= take;
      if (shares[i] < lengths[i]) next.push(i);
    }
    if (next.length === open.length) break;
    open = next;
  }
  return shares;
}

export class WebsiteAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  private guessDomain(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9& ]/g, "")
      .replace(/\s*&\s*/g, "and")
      .replace(/\s+/g, "");
    return `https://www.${slug}.com`;
  }

  /** The page, or its contact or about page, names the city: the site
   *  belongs to the business at that location, not a same-named one
   *  elsewhere. Reads the full page: the address is usually in the footer. */
  private async siteMatchesCity(page: { url: string; text: string }, city: string): Promise<boolean> {
    const has = (t: string | null | undefined) => !!t && normalizeWords(t).includes(normalizeWords(city));
    if (has(page.text)) return true;
    let origin: string;
    try { origin = new URL(page.url).origin; } catch { return false; }
    for (const url of [page.url, `${origin}/contact`, `${origin}/contact-us`, `${origin}/about`]) {
      const html = await this.fetcher.fetchText(url);
      if (html && has(htmlToFullText(html))) return true;
    }
    return false;
  }

  /** Fetches a page with the reason it failed, from providers that report one. */
  private async fetchPage(url: string, fallback = false): Promise<FetchedPage> {
    if (this.fetcher.fetchPage) return this.fetcher.fetchPage(url, fallback);
    const html = await this.fetcher.fetchText(url);
    return html ? { html } : { html: null, reason: "the site couldn't be reached" };
  }

  /**
   * Reads a business's own site (round 2, Fix 1; launch fix 1): the
   * homepage plus its inner pages, from the sitemap or else the homepage's
   * links: about, team, locations, services, press, acquisitions and
   * contact, before any web search. Returns the combined text, each page
   * read, and the record (name, address, phone, hours, people) the site
   * states, or why it couldn't be read.
   */
  private async readSite(website: string): Promise<SiteRead | { error: string }> {
    // A site that refuses us gets its www/bare twin, then a render or its
    // archived copy (launch fix 24: crumblcookies.com wasn't down).
    let home = await this.fetchPage(website, true);
    if (!home.html) {
      try {
        const u = new URL(website);
        u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
        const twin = await this.fetchPage(u.origin, true);
        if (twin.html) { home = twin; website = u.origin; }
      } catch { /* keep the first failure */ }
    }
    if (!home.html) return { error: home.reason ?? "the site couldn't be reached" };
    const viaFallback = !!home.via;
    const homeText = htmlToFullText(home.html);
    if (homeText.length < 80) return { error: "the site has no readable text (it may need a browser to load)" };
    let origin = website;
    try { origin = new URL(website).origin; } catch { /* keep as given */ }
    // Inner pages come the same way the homepage did.
    const get = async (u: string) => viaFallback ? (await this.fetchPage(u, true)).html : this.fetcher.fetchText(u);
    const sitemap = await get(`${origin}/sitemap.xml`);
    // A sitemap index points at the real ones; the page sitemap holds the
    // inner pages (WordPress: page-sitemap.xml).
    let pagesXml = sitemap && /<sitemapindex/i.test(sitemap) ? null : sitemap;
    if (sitemap && !pagesXml) {
      const children = sitemapUrls(sitemap);
      const pick = children.find((u) => /page/i.test(u)) ?? children[0];
      pagesXml = pick ? await get(pick) : null;
    }
    const targets = crawlTargets(home.html, website, pagesXml);
    const subpages = await Promise.all(targets.map(async (t) => ({ ...t, html: await get(t.url) })));
    const record = readSiteRecord(home.html);
    for (const p of subpages) {
      if (!p.html) continue;
      const sub = readSiteRecord(p.html);
      record.address ??= sub.address;
      record.city ??= sub.city;
      record.state ??= sub.state;
      record.phone ??= sub.phone;
      record.hours ??= sub.hours;
      for (const person of sub.people) {
        if (!record.people.some((x) => x.name.toLowerCase() === person.name.toLowerCase())) record.people.push(person);
      }
    }
    const pages = [
      { url: website, kind: "home", text: homeText },
      ...subpages.filter((p) => p.html).map((p) => ({ url: p.url, kind: p.kind, text: pageBody(p.html!, homeText) })),
    ];
    // A long homepage can't crowd out the About page that has the founding
    // year, and the last kinds read (press, acquisitions, contact) still
    // fit; a short page's unused share goes to the longer ones (launch fix
    // 50: Gecko lost its products and industry, Promise all but one service).
    const homeShare = 2000;
    const shares = budgetShares(pages.slice(1).map((p) => p.text.length), SITE_TEXT_BUDGET - homeShare - pages.length * 40);
    const text = pages.map((p, i) => `PAGE (${p.kind}, ${p.url}):\n${p.text.slice(0, i === 0 ? homeShare : shares[i - 1])}`).join("\n\n");
    const emailDomain = sendingDomain([home.html, ...subpages.map((p) => p.html ?? "")], website);
    return { text, record, url: website, pages, via: home.via, emailDomain };
  }

  /**
   * The business listing whose own website is the one the user gave, for
   * when the site itself can't be read. Matched on the domain, never the
   * name: a URL-only search looks its name up from the site's search
   * results first.
   */
  private async listingForSite(queryName: string, anchor: CompanyAnchor): Promise<{ listing: PlaceResult; chain: boolean } | undefined> {
    if (!this.searcher.places || !anchor.website) return undefined;
    const domain = hostOf(anchor.website);
    let name = queryName;
    if (anchor.nameFromSite) {
      const top = (await this.searcher.search(`site:${domain}`, 3)).find((r) => hostOf(r.url) === domain);
      name = top?.title.split(/\s[|\-–—·:]\s/)[0].trim() ?? "";
      if (!name) return undefined;
    }
    const places = await this.searcher.places(`${name}${anchor.location ? ` ${anchor.location}` : ""}`);
    const own = places.filter((p) => hostOf(p.website) === domain);
    const found = own[0];
    if (!found) return undefined;
    // Several listings link to the one site: a chain (launch fix 25). One
    // store is never the company, its city never the HQ (Crumbl's report
    // was anchored to a Hilton Head store).
    const chain = !anchor.location && own.length >= 2;
    // Name-only listings sometimes give just the street ("19524 Nordhoff
    // St #3B"): looking it up by that street returns the full address.
    if (!chain && !listingCity(found.address) && found.address) {
      const full = (await this.searcher.places(`${found.title} ${found.address}`)).find((p) => hostOf(p.website) === domain);
      if (full && listingCity(full.address)) return { listing: full, chain };
    }
    return { listing: found, chain };
  }

  /**
   * A business listing (Google Maps via Serper) with this exact name at the
   * anchor city (round 2, Fix 2). Its website is accepted as the
   * business's own; its address confirms the city.
   */
  private async findListing(companyName: string, location: string): Promise<{ title: string; address?: string; website?: string } | undefined> {
    if (!this.searcher.places) return undefined;
    const city = cityOf(location);
    const places = await this.searcher.places(`${companyName} ${location}`);
    return places.find((p) => mentionsCompany(p.title, companyName)
      && !!city && normalizeWords(p.address ?? "").includes(normalizeWords(city)));
  }

  /**
   * @param anchor What the user gave to pin down which business (Fix 1).
   *   A website is read first and becomes the record every other source
   *   is checked against (round 2, Fix 1); a location narrows every search,
   *   and a site that doesn't name that city is not used unless a business
   *   listing at that city links to it (round 2, Fix 2).
   */
  async run(queryName: string, anchorIn: CompanyAnchor = {}): Promise<WebsiteAgentResult> {
    const sources: Source[] = [];
    // The user saw the same-named businesses and none was theirs: nothing
    // found by name alone can be trusted to be about it.
    if (anchorIn.unlisted) {
      return { company: { name: queryName, anchor: anchorIn, thin: true }, leadership: [], products: [], sources };
    }

    // Website-first (round 2, Fix 1): the site the user gave settles which
    // business this is. If it can't be read, the report says so and why;
    // it never falls back to matching the name alone.
    let site: SiteRead | undefined;
    let companyName = queryName;
    let anchor = anchorIn;
    let siteUnreadable: string | undefined;
    let siteListing: PlaceResult | undefined;
    let chain = false;
    if (anchorIn.website) {
      const read = await this.readSite(anchorIn.website);
      if ("error" in read) {
        console.log(`[website-agent] "${queryName}" — couldn't read ${anchorIn.website}: ${read.error}`);
        siteUnreadable = read.error;
        // Still matched on the website, never the name: a business listing
        // whose own website is this domain says which business it is.
        const matched = await this.listingForSite(queryName, anchorIn);
        siteListing = matched?.listing;
        chain = !!matched?.chain;
        if (!siteListing) {
          return {
            company: { name: queryName, anchor: anchorIn, website: anchorIn.website, siteUnreadable, thin: true },
            leadership: [], products: [], sources,
          };
        }
        // A chain store's title carries its location ("Crumbl - Hilton Head").
        companyName = anchorIn.nameFromSite ? (chain ? siteListing.title.split(/\s[|\-–—·]\s/)[0].trim() : siteListing.title) : queryName;
        const city = listingCity(siteListing.address);
        const state = siteListing.address?.match(/\b([A-Z]{2})\s+\d{5}\b/)?.[1];
        if (!anchorIn.location && city && !chain) anchor = { ...anchorIn, location: [city, state].filter(Boolean).join(", ") };
      } else {
        site = read;
      }
    }
    if (site) {
      const read = site;
      if (anchorIn.nameFromSite && read.record.name) companyName = read.record.name;
      // The site's own city anchors every search below, so a same-named
      // business elsewhere can't pass as this one.
      if (!anchorIn.location && read.record.city) {
        anchor = { ...anchorIn, location: [read.record.city, read.record.state].filter(Boolean).join(", ") };
      }
    }

    const override = findOverride(companyName);
    const city = cityOf(anchor.location);
    // Only a city the user typed makes this "a location of a larger brand"
    // (launch fix 20): the city read off the company's own site is its HQ,
    // never a franchise or branch (Graybar's Clayton HQ was labeled one).
    const userCity = anchorIn.location ? city : undefined;
    const loc = anchor.location ? ` ${anchor.location}` : "";
    const userLocation = !anchor.website && anchor.location;
    // A listing with this name at the anchor city proves its website, even
    // when the site never names the city itself (round 2, Fix 2).
    const listing = siteListing ?? (userLocation ? await this.findListing(companyName, anchor.location!) : undefined);
    const listingSite = siteListing ? anchorIn.website
      : listing?.website && isOfficialDomain(listing.website) ? new URL(listing.website).origin : undefined;
    // A known override's own domain is a better direct guess than the
    // generic slugify-the-name heuristic (e.g. "Alan Health" -> guessed
    // "alanhealth.com", which either doesn't resolve or isn't the real
    // site — the override already knows it's alanmeds.com).
    const directUrl = anchor.website
      ?? listingSite
      ?? (override ? `https://${override.canonical_domain}` : this.guessDomain(companyName));

    const resolvePage = async (): Promise<ResolvedPage | null> => {
      if (site) return { url: site.url, text: site.text, fromSnippets: false };
      if (listingSite) {
        // The listing already proved the site: read it, but never swap in a
        // search result for it.
        const html = await this.fetcher.fetchText(listingSite);
        const text = html ? htmlToFullText(html) : "";
        return text.length >= 120 ? { url: listingSite, text, fromSnippets: false } : null;
      }
      return resolveAndFetch(directUrl, appendDomainExclusions(`${companyName}${loc} official website`, override), this.fetcher, this.searcher);
    };

    // 7/20 hardening — exclude a known-wrong domain (e.g. alan.com) at
    // the query itself via Serper/Google's -site: operator, on top of
    // the isRejectedDomain post-filter below. Query-level exclusion
    // means the result-count budget (5, 3, etc per call) isn't partly
    // spent on hits that were only going to be dropped anyway.
    const [pageRaw, leadershipResultsRaw, productResultsRaw, overviewResultsRaw, locationResultsRaw, licenseResultsRaw] =
      await Promise.all([
        resolvePage(),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} CEO founder executive leadership team`, override), 5),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} products and services`, override), 5),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} overview what is`, override), 3),
        // The location itself (Fix 4): its listing carries the address and
        // "permanently closed", which the brand's own site never says.
        anchor.location
          ? this.searcher.search(`"${companyName}" ${anchor.location} address hours`, 5)
          : Promise.resolve([]),
        // Licensing boards and their public mirrors (round 2, Fix 2): a
        // contractor or practice with no website still has a license
        // record naming it and its city.
        userLocation
          ? this.searcher.search(`"${companyName}" ${anchor.location} license`, 5)
          : Promise.resolve([]),
      ]);

    // Drop any result whose domain is on this entity's reject list before
    // it can influence sources, the LLM prompt, or the heuristic fallback.
    let page = pageRaw && !isRejectedDomain(pageRaw.url, override) ? pageRaw : null;
    // Anchor fields must agree: with a city given, a site that never names
    // it is a same-named business elsewhere, so neither its URL nor its
    // text goes into the report. A website the user typed, or one a
    // listing at that city links to, is trusted.
    if (page && city && !site && !listingSite && !(await this.siteMatchesCity(page, city))) {
      console.log(`[website-agent] "${companyName}" — ${page.url} doesn't name ${city}; not used`);
      page = null;
    }

    const company: CompanyProfile = { name: companyName };
    if (anchor.location || anchor.website) company.anchor = anchor;
    if (siteUnreadable) company.siteUnreadable = siteUnreadable;

    if (site?.via) company.siteVia = site.via;
    if (site?.emailDomain) company.emailDomain = site.emailDomain;
    if (site) {
      company.website = site.url;
    } else if (listingSite) {
      company.website = listingSite;
    } else if (page && !page.fromSnippets) {
      // Search snippets mean the site itself was never reached, so the
      // guessed domain isn't shown as the website.
      company.website = isOfficialDomain(page.url) ? page.url : directUrl;
    }

    // With an anchor, a search result counts only if it's on the business's
    // own site or names it and the city (round 2, Fix 1): a namesake's
    // pages never reach the extraction prompt.
    const anchored = !!(anchor.location || anchor.website);
    const tieRecord = { name: companyName, anchor, domain: hostOf(company.website) };
    // A website with no city to go with it: only its own pages tie, since
    // the name alone is exactly what a namesake shares.
    const domainOnly = !!anchor.website && !anchor.location;
    const onDomain = (url: string) => {
      const host = hostOf(url);
      return !!host && !!tieRecord.domain && (host === tieRecord.domain || host.endsWith(`.${tieRecord.domain}`));
    };
    // Forums and other vendors' marketing pages never feed extraction
    // (launch P0, source quality).
    const usable = (r: SearchResult) => !isRejectedDomain(r.url, override)
      && isCitable(r.url, tieRecord.domain)
      && (domainOnly ? onDomain(r.url) : !anchored || tiedToSubject(`${r.title}. ${r.snippet ?? ""}`, r.url, tieRecord));
    const leadershipResults = leadershipResultsRaw.filter(usable);
    const productResults = productResultsRaw.filter(usable);
    const overviewResults = overviewResultsRaw.filter(usable);
    const seenListing = new Set<string>();
    const locationResults = [...locationResultsRaw, ...licenseResultsRaw].filter((r) => {
      if (!usable(r) || seenListing.has(r.url)) return false;
      seenListing.add(r.url);
      return true;
    });

    if (page) {
      // Snippets only: the guessed domain still counts when search results
      // come from it (the site exists, it just didn't serve this fetcher).
      const guessedHost = hostOf(directUrl);
      if (page.fromSnippets && !company.website && guessedHost
        && [...overviewResults, ...leadershipResults, ...productResults, ...locationResults].some((r) => hostOf(r.url) === guessedHost)) {
        company.website = directUrl.replace("://www.", "://");
      }
      if (userCity && !page.fromSnippets && !site && BRAND_SITE.test(page.text)) company.brandLevel = true;
      sources.push({
        url: page.url,
        title: companyName,
        retrievedAt: new Date().toISOString(),
        usedFor: ["overview"],
      });
    }
    if (listing && chain) {
      // One store of a chain: it proves the site, nothing more.
      company.chain = true;
      sources.push({ url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.title)}`,
        title: `${listing.title} — one location's listing`, retrievedAt: new Date().toISOString(), usedFor: ["overview"] });
    } else if (listing) {
      company.listing = {
        title: listing.title,
        address: listing.address,
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${listing.title} ${listing.address ?? ""}`.trim())}`,
      };
      sources.push({ url: company.listing.url, title: `${listing.title} — business listing`, retrievedAt: new Date().toISOString(), usedFor: ["overview"] });
    }
    for (const r of leadershipResults) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["leadership"] });
    }
    for (const r of productResults) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["products"] });
    }
    for (const r of [...overviewResults, ...locationResults]) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["overview"] });
    }

    // Fetch full page text for the top leadership/product results — "meet
    // the team" and product pages are usually much richer than a snippet
    // (which often just truncates a list of names), same pattern as
    // people-agent/news-agent.
    // Found by name, the official site is crawled too (launch fix 1): its
    // inner pages carry the founding year, locations and service lines.
    let crawlOrigin: string | undefined;
    if (!site && company.website && page && !page.fromSnippets && isOfficialDomain(company.website)) {
      try { crawlOrigin = new URL(company.website).origin; } catch { /* not crawled */ }
    }
    const [leadershipPages, productPages, crawled] = await Promise.all([
      Promise.all(leadershipResults.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 2000))),
      Promise.all(productResults.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 2000))),
      crawlOrigin ? this.readSite(crawlOrigin) : Promise.resolve(undefined),
    ]);
    const own: SiteRead | undefined = site ?? (crawled && !("error" in crawled) ? crawled : undefined);
    if (own) {
      const usedFor: Record<string, string> = { team: "leadership", services: "products", acquisitions: "products" };
      for (const p of own.pages.slice(1)) {
        sources.push({ url: p.url, title: `${companyName} — ${p.kind} page`, retrievedAt: new Date().toISOString(), usedFor: [usedFor[p.kind] ?? "overview"] });
      }
    }

    // Combine everything gathered into one block for a single LLM call.
    // The business's own site leads, in full (its nav lists the services).
    const combinedText = [
      own ? `OFFICIAL SITE TEXT (${own.url}):\n${own.text.slice(0, SITE_TEXT_BUDGET)}`
        : page ? `OFFICIAL SITE TEXT:\n${extractBestChunk(cleanPageText(page.text), 2000)}` : "",
      locationResults.length
        ? `LISTINGS AND LICENSE RECORDS:\n${locationResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}`
        : "",
      overviewResults.length
        ? `OVERVIEW SEARCH:\n${overviewResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}`
        : "",
      leadershipResults.length
        ? `LEADERSHIP SEARCH RESULTS:\n${[
            leadershipPages.map((t, i) => (t ? `FULL PAGE (${leadershipResults[i].url}):\n${t}` : "")).filter(Boolean).join("\n\n"),
            leadershipResults.filter((_r, i) => i >= 2 || !leadershipPages[i]).map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n"),
          ].filter(Boolean).join("\n\n")}`
        : "",
      productResults.length
        ? `PRODUCTS SEARCH RESULTS:\n${[
            productPages.map((t, i) => (t ? `FULL PAGE (${productResults[i].url}):\n${t}` : "")).filter(Boolean).join("\n\n"),
            productResults.filter((_r, i) => i >= 2 || !productPages[i]).map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n"),
          ].filter(Boolean).join("\n\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, PROMPT_TEXT_BUDGET);

    let leadership: LeadershipEntry[] = [];
    let products: ProductEntry[] = [];
    let usedLLM = false;

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a business research assistant extracting verified facts about "${companyName}" from search results and website text.

CRITICAL RULES — violations undermine credibility:
- description: 1-2 sentences maximum. State what the company DOES and who it serves. No filler phrases like "well-positioned", "leading provider", "innovative solutions", "leverages cutting-edge". Use plain, specific language. If you can't describe what they do specifically, return a blank description rather than a generic one.
- The company's own site pages come first and outrank search results. Read every PAGE block: about/history pages give the founding year, contact and locations pages give the headquarters and locations, services pages give what it sells.
- founded: year only, as a string (e.g. "2012"). If unknown, omit.
- headquarters: city and state/country only, from the company's own contact, about or locations page when it has one. If unknown, omit.
- locations: every office, clinic, branch or facility the company's own pages list, each as "City, ST". Omit if none are listed.
- industry: specific sector (e.g. "Revenue-Based Financing" not just "Fintech"). Be precise.
- role: what kind of business this is, in 2-5 plain words that name its peers' role too, e.g. "commercial mechanical contractor", "student housing investment sponsor", "pediatric ABA therapy provider", "online payments processor". Omit if unclear.
- leadership: extract ALL named executives with their exact titles. Include CEO, founders, presidents, CFOs, CTOs. Only include people explicitly named in the source text — do NOT invent or guess names. Return each person as their own separate {name, title} object — a "meet the team" page often lists several people in one paragraph; do NOT merge two people into a single entry or split one person's name across two entries. name and title must be plain text only: no markdown (no "**", no bullet "-" or "—" characters), no trailing punctuation, and no credentials or extra names appended after the title.
- products: the products or service lines the company itself sells, as its own pages name them (e.g. "Early intervention ABA", "Adult services", "HVAC service and maintenance"). Never a page or link title ("Careers at X", "X Crunchbase profile"), never another company's product, and never a technique, method or credential it uses. Do NOT include generic descriptions like "cloud platform" or "SaaS solution" unless a specific product name is given.

Return only facts that are explicitly stated in the source text. Omit fields where the data is absent or ambiguous rather than filling them with guesses.`,
        combinedText,
        CompanyExtractionSchema
      );

      if (llmResult) {
        usedLLM = true;
        if (llmResult.description) company.description = llmResult.description;
        if (llmResult.founded) company.founded = llmResult.founded;
        if (llmResult.headquarters) company.headquarters = llmResult.headquarters;
        if (llmResult.industry) company.industry = llmResult.industry;
        if (llmResult.role) company.role = llmResult.role;
        if (llmResult.locations?.length) company.locations = llmResult.locations;
        if (llmResult.leadership) {
          leadership = llmResult.leadership
            .map((l) => ({
              name: cleanLeadershipField(l.name),
              title: cleanLeadershipField(l.title),
            }))
            .filter((l) => l.name.length > 0 && l.name.length < 80);
        }
        if (llmResult.products) {
          products = cleanProducts(llmResult.products.map((p) => ({
            name: p.name,
            description: p.description,
          })), companyName, combinedText);
        }
      }
    }

    // Heuristic fallback — use search snippets instead of raw page text
    // since page text is often nav-menu noise for JS-rendered sites.
    if (!usedLLM || !company.description) {
      const snippetDesc = trimToSentence(
        overviewResults
          .map((r) => r.snippet)
          .filter(Boolean)
          .join(" "),
        500
      ).trim();
      if (snippetDesc) {
        company.description = snippetDesc;
      } else if (page) {
        company.description = trimToSentence(cleanPageText(page.text), 500).trim();
      }
    }

    if (leadership.length === 0) {
      const seenLeaders = new Set<string>();
      for (const r of leadershipResults) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        for (const p of extractPeopleWithTitles(text)) {
          // Dedupe on the cleaned name, not the raw extraction — two
          // extractions of the same person can differ by a trailing
          // artifact ("Brian Schimpf" vs "Brian Schimpf -") that
          // cleanLeadershipField would normalize away, but a dedup key
          // built before cleaning treats them as different people.
          const cleanedName = cleanLeadershipField(p.name);
          const key = cleanedName.toLowerCase();
          if (seenLeaders.has(key)) continue;
          seenLeaders.add(key);
          leadership.push({
            name: cleanedName,
            title: cleanLeadershipField(p.title),
          });
        }
      }
    }

    if (products.length === 0) {
      const seenProducts = new Set<string>();
      for (const r of productResults) {
        const text = `${r.title} ${r.snippet ?? ""}`;
        for (const name of extractProductCandidates(text)) {
          const lower = name.toLowerCase();
          const companyLower = companyName.toLowerCase();
          if (lower === companyLower) continue;
          const words = name.split(/\s+/);
          const nonCompanyWords = words.filter(
            (w) => w.toLowerCase() !== companyLower
          );
          if (
            nonCompanyWords.length < words.length &&
            nonCompanyWords.every((w) => PRODUCT_STOPWORDS.has(w))
          ) {
            continue;
          }
          if (seenProducts.has(lower)) continue;
          seenProducts.add(lower);
          products.push({ name });
          if (products.length >= 10) break;
        }
        if (products.length >= 10) break;
      }
    }

    products = cleanProducts(products, companyName);

    // Every leader and product links to a page tied to this company (its
    // own site, or one naming it and the city); anything else is dropped.
    const subject = { name: companyName, anchor, domain: hostOf(company.website) };
    // A location search that turns up the brand's own franchise or
    // locations pages is a location of a larger brand (Fix 4).
    if (userCity && !company.brandLevel && (CHAIN_DESCRIPTION.test(company.description ?? "")
      || [...overviewResults, ...leadershipResults, ...productResults]
        .some((r) => (hostOf(r.url) === subject.domain || mentionsCompany(r.title, companyName)) && BRAND_SITE.test(`${r.title} ${r.snippet ?? ""}`)))) {
      company.brandLevel = true;
    }
    // "Franchise" only when a source says so; otherwise it's one location
    // of the company (launch fix 20).
    if (company.brandLevel && FRANCHISE.test([company.description, ...[...overviewResults, ...locationResults].map((r) => `${r.title} ${r.snippet ?? ""}`)].join(" "))) {
      company.franchise = true;
    }
    const tiedTexts = [
      ...(own ? own.pages.map((p) => ({ text: p.text, url: p.url })) : []),
      ...(page && !page.fromSnippets ? [{ text: page.text, url: page.url }] : []),
      ...leadershipPages.map((t, i) => ({ text: t ?? "", url: leadershipResults[i]?.url ?? "" })),
      ...productPages.map((t, i) => ({ text: t ?? "", url: productResults[i]?.url ?? "" })),
      ...[...leadershipResults, ...productResults, ...overviewResults, ...locationResults]
        .map((r) => ({ text: `${r.title}. ${r.snippet ?? ""}`, url: r.url })),
    ].filter((t) => t.text && t.url && tiedToSubject(t.text, t.url, subject))
      .map((t) => ({ words: wordSet(t.text), url: t.url }));
    leadership = leadership
      .filter((l) => isPersonName(l.name, companyName) && !/\b(of|and|&|for|at|the)$|[,:]$/i.test(l.title.trim()))
      .map((l) => ({ ...l, sourceUrl: sourceFor(l.name, tiedTexts) }))
      .filter((l) => l.sourceUrl);
    // When each source said so, so a newer page wins a title (launch fix 7).
    const dated = new Map([...leadershipResults, ...overviewResults].filter((r) => r.date).map((r) => [r.url, r.date!]));
    leadership = leadership.map((l) => ({ ...l, asOf: l.sourceUrl ? dated.get(l.sourceUrl) : undefined }));
    // A place is never an offering ("Arleta CA" off a listing title).
    // Offerings come from the business's own pages when it has a site
    // (round 2, Fix 5): a headline elsewhere ("MJW Leans Into Student
    // Housing") isn't a service. With no site, listing and license pages
    // are all there is.
    const ownPage = (url: string | undefined) => !company.website || (!!url && onDomain(url));
    products = products
      .filter((p) => !city || !normalizeWords(p.name).includes(normalizeWords(city)))
      .filter((p) => !isLinkTitle(p.name, companyName))
      .map((p) => ({ ...p, sourceUrl: sourceFor(p.name, tiedTexts.filter((t) => ownPage(t.url))) }))
      .filter((p) => p.sourceUrl);

    // The site's own record (round 2, Fix 1): its address, phone, hours and
    // the people it names with a credential are facts, not extractions.
    if (own) {
      const r = own.record;
      if (r.address) company.address = r.address;
      if (r.phone) company.phone = r.phone;
      if (r.hours) company.hours = r.hours;
      if (r.city) company.headquarters = [r.city, r.state].filter(Boolean).join(", ");
      for (const p of r.people) {
        if (!leadership.some((l) => l.name.toLowerCase() === p.name.toLowerCase())) {
          leadership.push({ name: p.name, title: p.title, sourceUrl: own.url });
        }
      }
    }
    if (listing?.address && !chain) company.address ??= listing.address;

    // Never echo the query as a finding: the city the user typed is the
    // headquarters only if a source used here names it.
    const locationText = [...locationResults.map((r) => `${r.title} ${r.snippet ?? ""}`), listing?.address ?? ""].join("\n");
    if (anchor.location) {
      const hqNamesCity = !!company.headquarters && normalizeWords(company.headquarters).includes(normalizeWords(city!));
      if (!hqNamesCity) {
        company.headquarters = anchor.location;
        if (!normalizeWords(`${combinedText}\n${locationText}`).includes(normalizeWords(city!))) company.headquartersUnverified = true;
      }
    }

    company.closure = detectClosure([
      ...(page && !page.fromSnippets ? [{ text: page.text, url: page.url }] : []),
      ...[...locationResults, ...overviewResults, ...leadershipResults, ...productResults].map((r) => ({ text: `${r.title}. ${r.snippet ?? ""}`, url: r.url })),
    ], companyName, city);

    // Nothing ties to this business — no site, no listing at the anchor
    // city, no license or listing page naming it and the city: say so
    // plainly instead of filling the report from whatever shares the name
    // (Fix 1). Any one of those is proof enough (round 2, Fix 2).
    if (!page && !company.website && !listing && locationResults.length === 0) {
      company.thin = true;
      delete company.description;
      return { company, leadership: [], products: [], sources: [] };
    }

    // A name extracted without a title gets the one its pages give.
    const pageTexts = [...(own ? own.pages.map((p) => p.text) : []), ...[...leadershipResults, ...overviewResults].map((r) => `${r.title}. ${r.snippet ?? ""}`)];
    leadership = leadership.map((l) => (!l.title || /^unknown$/i.test(l.title.trim()) ? { ...l, title: titleNear(l.name, pageTexts) ?? l.title } : l));
    leadership = cleanLeadership(leadership, subject.domain);

    // Section citations list only pages about this company: its own site,
    // or a page whose title names it (a same-named or unrelated page out).
    const cited = sources.filter((s) => {
      const host = hostOf(s.url);
      return (!!subject.domain && !!host && (host === subject.domain || host.endsWith(`.${subject.domain}`)))
        || mentionsCompany(s.title ?? "", companyName);
    });

    return { company, leadership, products, sources: cited };
  }
}