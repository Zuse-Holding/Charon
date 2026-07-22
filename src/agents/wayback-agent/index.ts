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

export class WaybackAgent {
  async run(websiteUrl: string): Promise<{ summary: WebArchiveSummary; sources: Source[] }> {
    if (!websiteUrl) return { summary: {}, sources: [] };

    // Strip protocol — CDX matches more reliably on bare host+path, and
    // this also naturally captures http:// AND https:// era snapshots.
    const bareUrl = websiteUrl.replace(/^https?:\/\//, "");

    try {
      // collapse=timestamp:8 dedupes to at most one capture per day,
      // keeping the response small — plenty of resolution for a
      // first-seen/last-seen/count summary rather than a full timeline.
      const res = await fetch(
        `${CDX_BASE}?url=${encodeURIComponent(bareUrl)}&output=json&collapse=timestamp:8&fl=timestamp,original&limit=10000`,
        { signal: AbortSignal.timeout(15_000) }
      );

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

      return { summary, sources };
    } catch (err) {
      console.warn(`[wayback-agent] "${bareUrl}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { summary: {}, sources: [] };
    }
  }
}
