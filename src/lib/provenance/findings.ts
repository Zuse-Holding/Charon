import { z } from "zod";
import { sha256, type Snapshot } from "./snapshots.js";

/**
 * Provenance on every finding (Feature 2). A finding is one claim a report
 * makes (a leader, a competitor, a sanctions match, a risk) plus where it
 * came from. The schema is the gate: a finding without a source URL, a
 * retrieval time or a snapshot hash fails validation and is never saved.
 *
 * Verification:
 *   confirmed      the claim's text appears in responses from two or more
 *                  independent sites
 *   single_source  it appears in exactly one
 *   unverified     no stored response contains it (typically an AI
 *                  summary); it is kept and shown, never dropped
 */

export const RETRIEVAL_METHODS = ["api", "scrape", "manual_entry", "ai_extracted"] as const;
export const VERIFICATION_STATES = ["confirmed", "single_source", "unverified"] as const;
export type RetrievalMethod = (typeof RETRIEVAL_METHODS)[number];
export type Verification = (typeof VERIFICATION_STATES)[number];

const hash = z.string().regex(/^[0-9a-f]{64}$/, "must be a SHA-256 hex digest");

export const FindingSchema = z.object({
  section: z.string().min(1),
  claim: z.string().min(1),
  source_name: z.string().min(1),
  source_url: z.url({ protocol: /^https?$/ }),
  retrieved_at: z.iso.datetime(),
  retrieval_method: z.enum(RETRIEVAL_METHODS),
  snapshot_hash: hash,
  verification: z.enum(VERIFICATION_STATES),
  /** Other stored responses that also contain the claim. */
  supporting_hashes: z.array(hash),
});

export type Finding = z.infer<typeof FindingSchema>;

/** Throws a ZodError naming the missing or invalid fields. */
export function validateFinding(input: unknown): Finding {
  return FindingSchema.parse(input);
}

/** What a report section claims, before it's traced to a source. */
export interface Candidate {
  section: string;
  claim: string;
  /** Words that must all appear in a response for it to support the
   *  claim (a name, a number). Empty = can't be traced; stays unverified. */
  terms: string[];
  method: RetrievalMethod;
  /** Direct link to the record when the source gave one. */
  recordUrl?: string;
  sourceName?: string;
  /** The claim is a direct reading of the response fetched from
   *  recordUrl (e.g. "no DMARC record" from a DNS answer), so that stored
   *  response supports it even when no text in it can be matched. */
  direct?: boolean;
}

// Search engines return other sites' snippets: useful evidence, but not an
// independent source of their own.
const SEARCH_HOSTS = ["google.serper.dev"];

/** Lowercase, \uXXXX escapes decoded, basic entities decoded, every run of
 *  non-alphanumerics collapsed to one space. */
export function normalize(text: string): string {
  return ` ${text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** example.co.uk -> example.co.uk, news.example.com -> example.com */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const twoLevel = /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoLevel ? -3 : -2).join(".");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export interface Fallback {
  url: string;
  name?: string;
}

/** Numbers, money and percentages in a sentence: the parts of an AI
 *  summary that can be checked against a source. */
export function numericTerms(text: string): string[] {
  return [...new Set((text.match(/\$?\d[\d,.]*\d%?|\$?\d%?/g) ?? []).filter((t) => t.replace(/\D/g, "").length >= 2))];
}

export interface TraceResult {
  findings: Finding[];
  /** Stand-in snapshots created for claims no response contained. */
  generated: Snapshot[];
  /** Claims that couldn't be given a valid source at all (no usable link
   *  anywhere in the run). Counted so the report can say so. */
  untraceable: number;
}

/** In a search response, the link of the first result that itself
 *  contains every term: the page the claim came from, not the API call. */
export function searchResultLink(snapshot: Snapshot, terms: string[]): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(snapshot.body);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  for (const value of Object.values(data as Record<string, unknown>)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!item || typeof item !== "object") continue;
      const link = httpUrl((item as { link?: string }).link);
      if (link && terms.every((t) => normalize(JSON.stringify(item)).includes(t))) return link;
    }
  }
  return undefined;
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch {
    return a === b;
  }
}

function httpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Traces candidates to the stored responses that contain them.
 * fallbackFor(section) gives the nearest source for a claim nothing
 * contains, so even an unverified finding links somewhere real.
 */
export function traceFindings(
  candidates: Candidate[],
  snapshots: Snapshot[],
  fallbackFor: (section: string) => Fallback | undefined,
): TraceResult {
  const usable = snapshots.filter((s) => s.status >= 200 && s.status < 400 && !s.generated);
  const bodies = usable.map((s) => normalize(s.body));
  const generated: Snapshot[] = [];
  const findings: Finding[] = [];
  let untraceable = 0;

  for (const original of candidates) {
    // An agent's link that isn't a real web address (e.g. "#") is ignored,
    // so the finding falls back to the response that contains it.
    const c = { ...original, recordUrl: httpUrl(original.recordUrl) };
    const terms = c.terms.map(normalize).filter((t) => t.trim().length >= 2);
    let matches = terms.length === 0 ? [] : usable.filter((_, i) => terms.every((t) => bodies[i].includes(t)));
    if (matches.length === 0 && c.direct && c.recordUrl) {
      const own = usable.find((s) => sameUrl(s.url, c.recordUrl!));
      if (own) matches = [own];
    }
    const independent = new Set(matches.filter((s) => !SEARCH_HOSTS.includes(s.host)).map((s) => siteOf(s.host)));
    const verification: Verification =
      independent.size >= 2 ? "confirmed" : matches.length > 0 ? "single_source" : "unverified";

    // The page itself beats the search result that pointed to it.
    const ordered = [...matches].sort((a, b) => Number(SEARCH_HOSTS.includes(a.host)) - Number(SEARCH_HOSTS.includes(b.host)));
    let primary: Snapshot | undefined = c.recordUrl
      ? ordered.find((s) => siteOf(s.host) === siteOf(hostOf(c.recordUrl!))) ?? ordered[0]
      : ordered[0];

    let sourceUrl: string | undefined = c.recordUrl
      ?? (primary && SEARCH_HOSTS.includes(primary.host) ? searchResultLink(primary, terms) : undefined)
      ?? primary?.url;
    let sourceName = c.sourceName;
    if (!primary) {
      const fb = fallbackFor(c.section);
      sourceUrl = c.recordUrl ?? httpUrl(fb?.url);
      if (!sourceUrl) {
        untraceable += 1;
        continue;
      }
      sourceName ??= fb?.name;
      primary = usable.find((s) => s.url === sourceUrl);
      if (!primary) {
        // Nothing fetched holds this claim: store what the AI step produced,
        // so the finding still has a re-checkable record and a hash.
        const body = JSON.stringify({ section: c.section, claim: c.claim, method: c.method });
        primary = {
          sha256: sha256(body), url: sourceUrl, host: hostOf(sourceUrl), retrievedAt: new Date().toISOString(),
          status: 200, contentType: "application/json", body, generated: true,
        };
        generated.push(primary);
      }
    }

    if (!primary || !sourceUrl) {
      untraceable += 1;
      continue;
    }
    const kept = primary;
    const parsed = FindingSchema.safeParse({
      section: c.section,
      claim: c.claim,
      source_name: sourceName ?? siteOf(hostOf(sourceUrl)),
      source_url: sourceUrl,
      retrieved_at: kept.retrievedAt,
      retrieval_method: c.method,
      snapshot_hash: kept.sha256,
      verification,
      supporting_hashes: [...new Set(matches.map((s) => s.sha256).filter((h) => h !== kept.sha256))],
    });
    if (parsed.success) findings.push(parsed.data);
    else untraceable += 1;
  }
  return { findings, generated, untraceable };
}
