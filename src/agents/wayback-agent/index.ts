import { ArchiveSnapshot, Source, WebArchiveSummary } from "../../types/research.js";

/**
 * Wayback Machine Agent (7/20 public-record fusion, roadmap #2) — pulls
 * archive history for a company's website from web.archive.org. No API
 * key required. Company research only for now: this needs a canonical
 * URL to query, which siteResult.company.website already provides for
 * companies but PeopleAgent has no equivalent for a person (no reliable
 * "this person's website" field) — extending to person research would
 * mean guessing a URL, which isn't worth the false-positive risk yet.
 *
 * Uses the CDX API (not just the single-snapshot Availability API) to
 * get first-seen, most-recent, and total snapshot count — a rough proxy
 * for "how long has this site existed / how often does it change,"
 * useful context a single snapshot lookup wouldn't give.
 */

const CDX_BASE = "https://web.archive.org/cdx/search/cdx";

// Wayback timestamps are 14-digit YYYYMMDDhhmmss.
function toSnapshot(url: string, timestamp: string): ArchiveSnapshot {
  return { timestamp, url: `https://web.archive.org/web/${timestamp}/${url}` };
}

// Launch fix 55: "fetch failed" on every run. The archive is slow and
// drops anonymous clients under load, so requests identify themselves,
// wait longer, retry once, and a domain's history is reused for a day.
const WAYBACK_UA = "Metis Analytics (support@metisanalytic.com)";
const cache = new Map<string, { at: number; value: { summary: WebArchiveSummary; sources: Source[] } }>();
const DAY_MS = 86_400_000;

async function cdxFetch(url: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": WAYBACK_UA }, signal: AbortSignal.timeout(25_000) });
      if (res.ok || attempt === 1 || (res.status < 500 && res.status !== 429)) return res;
      console.warn(`[wayback-agent] HTTP ${res.status}, retrying`);
    } catch (err) {
      last = err;
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      console.warn(`[wayback-agent] request failed:`, err instanceof Error ? err.message : err, cause ? `(${cause.code ?? ""} ${cause.message ?? ""})`.trim() : "");
      if (attempt === 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw last instanceof Error ? last : new Error("Wayback request failed");
}

export class WaybackAgent {
  async run(websiteUrl: string): Promise<{ summary: WebArchiveSummary; sources: Source[] }> {
    if (!websiteUrl) return { summary: {}, sources: [] };

    // Strip protocol — CDX matches more reliably on bare host+path, and
    // this also naturally captures http:// AND https:// era snapshots.
    const bareUrl = websiteUrl.replace(/^https?:\/\//, "");
    const hit = cache.get(bareUrl);
    if (hit && Date.now() - hit.at < DAY_MS) return hit.value;

    try {
      // collapse=timestamp:8 dedupes to at most one capture per day,
      // keeping the response small — plenty of resolution for a
      // first-seen/last-seen/count summary rather than a full timeline.
      const res = await cdxFetch(`${CDX_BASE}?url=${encodeURIComponent(bareUrl)}&output=json&collapse=timestamp:8&fl=timestamp,original&limit=10000`);

      if (!res.ok) {
        console.warn(`[wayback-agent] "${bareUrl}" — HTTP ${res.status}`);
        return { summary: {}, sources: [] };
      }

      // CDX JSON format: first row is the field-name header, not data.
      const rows = (await res.json()) as string[][];
      const dataRows = rows.slice(1);

      if (dataRows.length === 0) {
        console.log(`[wayback-agent] "${bareUrl}" — no archived snapshots found`);
        return { summary: {}, sources: [] };
      }

      const first = dataRows[0];
      const last = dataRows[dataRows.length - 1];

      const summary: WebArchiveSummary = {
        firstSnapshot: toSnapshot(first[1] ?? websiteUrl, first[0]),
        latestSnapshot: toSnapshot(last[1] ?? websiteUrl, last[0]),
        snapshotCount: dataRows.length,
      };

      const sources: Source[] = [{
        url: `https://web.archive.org/web/*/${bareUrl}`,
        title: `Wayback Machine archive history — ${bareUrl}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["web-archive"],
      }];

      console.log(`[wayback-agent] "${bareUrl}" — ${dataRows.length} snapshot(s), first ${first[0]}, latest ${last[0]}`);

      cache.set(bareUrl, { at: Date.now(), value: { summary, sources } });
      return { summary, sources };
    } catch (err) {
      // Thrown, so the coverage table shows an error rather than "none".
      throw new Error(`Wayback Machine unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
