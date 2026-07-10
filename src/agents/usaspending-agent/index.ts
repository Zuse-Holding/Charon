import { FederalSpendingEntry, Source, USASpendingAgentResult } from "../../types/research.js";

/**
 * USASpending Agent (Round 2, item 3)
 *
 * Pulls federal contract/grant award data for a company from
 * USASpending.gov's public API — free, no API key required, available
 * to every tier (not gated the way political/deep-dive research is).
 *
 * Docs: https://api.usaspending.gov/docs/endpoints
 * Endpoint used: POST /api/v2/search/spending_by_award/
 *
 * Like every other agent here, this fails silently: a bad/slow response,
 * or a company with no federal awards (the overwhelming majority of
 * companies researched on this platform), just means an empty array —
 * never an error that blocks the rest of the research run.
 */

const USASPENDING_BASE = "https://api.usaspending.gov/api/v2";

// Contracts (A-D) and financial assistance/grants (02-05) are different
// award categories in USASpending's schema — queried separately rather
// than in one mixed array, since a first production run against
// Lockheed Martin (a huge federal contractor) came back completely
// empty, and a mixed award_type_codes filter across both categories in
// a single request is the most likely culprit if the API rejects or
// silently drops an invalid combination. Splitting into two requests
// costs one extra round trip but means a problem with one category
// can't silently zero out the other.
const CONTRACT_TYPE_CODES = ["A", "B", "C", "D"];
const GRANT_TYPE_CODES = ["02", "03", "04", "05"];

interface SpendingByAwardResponse {
  results?: Record<string, unknown>[];
}

function fiveYearWindow(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 5);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

function toStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

export class USASpendingAgent {
  // Each type-category request catches and logs its own failure rather
  // than throwing, so a slow/timed-out contracts request (seen in
  // production — "operation was aborted due to timeout") can't also
  // wipe out a successful grants request riding alongside it in
  // Promise.all, or vice versa. 20s timeout (up from 10s) since
  // USASpending's search endpoint is known to be slow under load.
  private async searchByType(companyName: string, awardTypeCodes: string[]): Promise<Record<string, unknown>[]> {
    try {
      const res = await fetch(`${USASPENDING_BASE}/search/spending_by_award/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            recipient_search_text: [companyName],
            award_type_codes: awardTypeCodes,
            time_period: [fiveYearWindow()],
          },
          fields: [
            "Award ID",
            "Recipient Name",
            "Awarding Agency",
            "Award Amount",
            "Start Date",
            "Description",
            "Award Type",
          ],
          sort: "Award Amount",
          order: "desc",
          limit: 10,
          page: 1,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        const bodySnippet = await res.text().catch(() => "");
        console.warn(
          `[usaspending-agent] "${companyName}" (types ${awardTypeCodes.join(",")}) — HTTP ${res.status}: ${bodySnippet.slice(0, 300)}`
        );
        return [];
      }

      const data = (await res.json()) as SpendingByAwardResponse;
      return data.results ?? [];
    } catch (err) {
      console.warn(
        `[usaspending-agent] "${companyName}" (types ${awardTypeCodes.join(",")}) — request failed:`,
        err instanceof Error ? err.message : err
      );
      return [];
    }
  }

  async run(companyName: string): Promise<USASpendingAgentResult> {
    try {
      const [contracts, grants] = await Promise.all([
        this.searchByType(companyName, CONTRACT_TYPE_CODES),
        this.searchByType(companyName, GRANT_TYPE_CODES),
      ]);
      const results = [...contracts, ...grants];

      console.log(`[usaspending-agent] "${companyName}": ${contracts.length} contract result(s), ${grants.length} grant result(s) before name-match filtering.`);

      // Guard against a loose recipient_search_text match returning
      // awards for an unrelated namesake — only keep results whose
      // recipient name actually contains the searched company name
      // (case-insensitive).
      const needle = companyName.toLowerCase();
      const filtered = results.filter((r) => {
        const recipient = toStr(r["Recipient Name"])?.toLowerCase() ?? "";
        return recipient.includes(needle) || needle.includes(recipient);
      });

      if (results.length > 0 && filtered.length === 0) {
        console.warn(`[usaspending-agent] "${companyName}": ${results.length} raw result(s) all rejected by the recipient-name match guard — check for a naming mismatch (e.g. "${companyName}" vs the recipient's registered legal name).`);
      }

      const awards: FederalSpendingEntry[] = filtered.map((r) => ({
        awardId: toStr(r["Award ID"]),
        awardingAgency: toStr(r["Awarding Agency"]),
        amount: formatAmount(r["Award Amount"]),
        date: toStr(r["Start Date"]),
        awardType: toStr(r["Award Type"]),
        description: toStr(r["Description"]),
      }));

      const sources: Source[] = awards.length > 0
        ? [{
            url: `https://www.usaspending.gov/search/?hash=&recipient_search_text=${encodeURIComponent(companyName)}`,
            title: `USASpending.gov — ${companyName}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["federal-spending"],
          }]
        : [];

      return { awards, sources };
    } catch (err) {
      console.warn(`[usaspending-agent] Lookup failed for "${companyName}":`, err instanceof Error ? err.message : err);
      return { awards: [], sources: [] };
    }
  }
}

function formatAmount(v: unknown): string | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return toStr(v);
  return `$${n.toLocaleString("en-US")}`;
}
