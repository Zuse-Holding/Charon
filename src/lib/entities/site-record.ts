import { htmlToFullText } from "../providers.js";

/**
 * Website-first resolution (round 2, Fix 1): when the user gives a website,
 * the site itself says which business this is. Everything here is read
 * straight from the page (JSON-LD first, then the visible text), never
 * guessed, so the record can be trusted to reject a namesake elsewhere.
 */
export interface SiteRecord {
  name?: string;
  /** "19524 W. Nordhoff Street Ste. 3B, Northridge, CA 91324". */
  address?: string;
  city?: string;
  /** Two-letter US state. */
  state?: string;
  phone?: string;
  /** "Monday 10:00 am - 7:00 pm; Tuesday ...". */
  hours?: string;
  /** Named providers or staff with a credential ("Jessica Lizana", "DDS"). */
  people: { name: string; title: string }[];
}

// A domain or URL typed into a search field. Emails don't count.
const SITE_RE = /(?:^|\s)((?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/[^\s]*)?)(?=\s|$)/i;
// Common words that look like domains when typed ("Inc.com" never happens,
// but "U.S." does): a TLD must be letters and the label must not be a bare
// initial.
const NOT_A_SITE = /^(?:[a-z]\.){1,3}[a-z]?$/i;

/** The website in a search field ("Smile Design Studio sdsdentistry.com",
 *  "https://sdsdentistry.com/"), as an origin, plus the text around it. */
export function findWebsite(text: string): { website: string; rest: string } | undefined {
  const m = text.match(SITE_RE);
  if (!m) return undefined;
  const raw = m[1];
  if (raw.includes("@") || NOT_A_SITE.test(raw)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) return undefined;
    const rest = text.replace(raw, " ").replace(/[·|,]+/g, " ").replace(/\s+/g, " ").trim();
    return { website: url.origin, rest };
  } catch {
    return undefined;
  }
}

/** "sdsdentistry.com" -> "sdsdentistry.com": the name to show until the
 *  site gives a better one. */
export function hostLabel(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
// "19524 W. Nordhoff Street Ste. 3B - Northridge, CA 91324"
const ADDRESS_RE = new RegExp(
  `\\b(\\d{1,6}\\s+[A-Za-z0-9][A-Za-z0-9.'#\\- ]{2,60}?)\\s*[,\\-–]?\\s+([A-Z][A-Za-z.]*(?:\\s[A-Z][A-Za-z.]*){0,3}),\\s*(${US_STATES})\\.?\\s+(\\d{5})(?:-\\d{4})?\\b`,
);
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/;
const DAY = "(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?";
const TIME_RANGE = "(?:\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?\\s*[-–]\\s*\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?|Closed)";
const CREDENTIAL = "DDS|DMD|MD|DO|DPM|OD|DC|DVM|PhD|NP|PA-C|RDH|CPA|Esq";
// "Dr. Jessica Lizana, DDS" or "Jessica Lizana, DDS": a full name, never
// a surname alone ("Dr. Callahan").
const PERSON_RE = new RegExp(
  `(?:\\bDr\\.?\\s+)?\\b([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-zA-Z'\\-]+),?\\s+(${CREDENTIAL})\\b`,
  "g",
);

interface JsonLdAddress { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string }

/** Every JSON-LD object on the page, flattened out of @graph arrays. */
function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== "object") continue;
        out.push(item as Record<string, unknown>);
        const graph = (item as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(graph)) stack.push(...graph);
      }
    } catch {
      // A malformed block is skipped; the visible text still has the facts.
    }
  }
  return out;
}

function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, "i");
  const m = html.match(re);
  return (m?.[1] ?? m?.[2])?.trim() || undefined;
}

/** "Smile Design Studio | Cosmetic Dentist in Northridge" -> "Smile Design Studio". */
function titleName(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const head = title?.replace(/&amp;/g, "&").split(/\s[|\-–—·:]\s/)[0].trim();
  return head && head.length >= 2 && head.length <= 80 && !/^(home|welcome|index)$/i.test(head) ? head : undefined;
}

/** Days listed together and their hours listed after them
 *  ("Monday, Tuesday ... 10:00 am - 7:00 pm, Closed, ..."), or inline pairs. */
function readHours(text: string): string | undefined {
  const at = text.search(/\b(?:opening|office|business)?\s*hours\b/i);
  if (at === -1) return undefined;
  const window = text.slice(at, at + 400);
  const days = [...window.matchAll(new RegExp(`\\b${DAY}\\b`, "gi"))].map((m) => m[0]);
  const times = [...window.matchAll(new RegExp(TIME_RANGE, "gi"))].map((m) => m[0].replace(/\s+/g, " ").replace(/\s*-\s*/, " - "));
  if (days.length === 0 || times.length === 0) return undefined;
  if (days.length === times.length) return days.map((d, i) => `${d} ${times[i]}`).join("; ");
  // Ranges like "Mon - Fri 9am - 5pm": keep the window's own wording.
  const inline = [...window.matchAll(new RegExp(`${DAY}(?:\\s*[-–]\\s*${DAY})?:?\\s*${TIME_RANGE}`, "gi"))].map((m) => m[0]);
  return inline.length ? inline.join("; ") : undefined;
}

export function readSiteRecord(html: string): SiteRecord {
  const record: SiteRecord = { people: [] };
  for (const item of jsonLd(html)) {
    const addr = item.address as JsonLdAddress | undefined;
    if (!record.address && addr && typeof addr === "object" && addr.addressLocality) {
      record.city = String(addr.addressLocality).trim();
      record.state = addr.addressRegion ? String(addr.addressRegion).trim() : undefined;
      record.address = [addr.streetAddress, record.city, [record.state, addr.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean).join(", ");
    }
    if (!record.phone && typeof item.telephone === "string") record.phone = item.telephone.trim();
    if (!record.name && typeof item.name === "string" && item.address) record.name = item.name.trim();
  }

  const text = htmlToFullText(html);
  record.name ??= metaContent(html, "og:site_name") ?? titleName(html);
  if (!record.address) {
    const m = text.match(ADDRESS_RE);
    if (m) {
      const street = m[1].replace(/\s*[-–]\s*$/, "").trim();
      record.city = m[2].trim();
      record.state = m[3];
      record.address = `${street}, ${record.city}, ${m[3]} ${m[4]}`;
    }
  }
  if (!record.phone) {
    const m = text.match(PHONE_RE);
    if (m) record.phone = `(${m[1]}) ${m[2]}-${m[3]}`;
  }
  record.hours = readHours(text);

  const seen = new Set<string>();
  for (const m of text.matchAll(PERSON_RE)) {
    const key = m[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    record.people.push({ name: m[1], title: m[2] });
  }
  return record;
}

const SUBPAGE_HINT = /about|provider|doctor|dentist|team|staff|people|leadership|service|contact/i;

/** Same-site pages worth reading after the homepage (about, providers,
 *  services, contact), at most `max`, in page order. */
export function subpageLinks(html: string, baseUrl: string, max = 3): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const out: string[] = [];
  const seen = new Set<string>([base.href]);
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let url: URL;
    try { url = new URL(m[1], base); } catch { continue; }
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (!/^https?:$/.test(url.protocol) || /\.(css|js|png|jpe?g|gif|svg|ico|pdf|webp)$/i.test(url.pathname)) continue;
    if (!SUBPAGE_HINT.test(url.pathname) || seen.has(url.href)) continue;
    // One services page stands for the rest (services01..13.html).
    const family = url.pathname.replace(/\d+(?=\.\w+$)/, "");
    if (seen.has(family)) continue;
    seen.add(url.href);
    seen.add(family);
    out.push(url.href);
    if (out.length >= max) break;
  }
  return out;
}
