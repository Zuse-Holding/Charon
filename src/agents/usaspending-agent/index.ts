import { FederalSpendingEntry, Source, USASpendingAgentResult } from "../../types/research.js";
import { findOverride } from "../../entity-validation.js";

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

/** Lowercase words only: "Stripe, Inc." -> "stripe inc". */
function words(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Whether an award's recipient is the company searched for. Whole words
 * only: substring matching let "STRIPES GLOBAL, INC." and "STATEWIDE
 * STRIPES, INC." through as Stripe (in production, 2026-10-05). A blank
 * recipient never matches.
 */
export function recipientMatches(recipient: string | null | undefined, needles: string[]): boolean {
  const r = words(recipient ?? "");
  if (!r) return false;
  return needles.some((needle) => {
    const n = words(needle);
    return !!n && (` ${r} `.includes(` ${n} `) || ` ${n} `.includes(` ${r} `));
  });
}

interface RecipientAutocomplete {
  results?: { recipient_name?: string; uei?: string | null; recipient_level?: string }[];
}

/** The UEIs registered under the company's name (whole-word match). */
export function matchingUeis(data: RecipientAutocomplete | null, needles: string[]): string[] {
  return [...new Set((data?.results ?? [])
    .filter((r) => r.uei && recipientMatches(r.recipient_name, needles))
    .map((r) => r.uei!.trim().toUpperCase()))].slice(0, 5);
}

export class USASpendingAgent {
  /**
   * The government's unique entity IDs for the company (launch fix 17):
   * awards are then matched on UEI, so a contract is attributed to this
   * registered entity, not anyone sharing the words of its name. Empty
   * when the lookup fails; the caller falls back to the name.
   */
  private async resolveUeis(searchName: string, needles: string[]): Promise<string[]> {
    try {
      const res = await fetch(`${USASPENDING_BASE}/autocomplete/recipient/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_text: searchName, limit: 20 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      return matchingUeis((await res.json()) as RecipientAutocomplete, needles);
    } catch {
      return [];
    }
  }

  // Each type-category request catches and logs its own failure rather
  // than throwing, so a slow/timed-out contracts request (seen in
  // production — "operation was aborted due to timeout") can't also
  // wipe out a successful grants request riding alongside it in
  // Promise.all, or vice versa. 20s timeout (up from 10s) since
  // USASpending's search endpoint is known to be slow under load.
  private async searchByType(searchText: string[], awardTypeCodes: string[]): Promise<Record<string, unknown>[]> {
    const companyName = searchText.join(", ");
    try {
      const res = await fetch(`${USASPENDING_BASE}/search/spending_by_award/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            recipient_search_text: searchText,
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
            "Recipient UEI",
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
      // Resolve a rename/aka override before querying — confirmed in
      // production this was exactly the predicted failure mode: Raytheon
      // renamed to RTX Corporation in 2023, federal contracts are now
      // registered under the new name, and searching "Raytheon" both
      // missed the recipient_search_text match AND would have failed
      // the name-match guard below even if USASpending's own fuzzy
      // search had found something.
      const override = findOverride(companyName);
      const searchName = override?.canonical_name ?? companyName;
      const acceptedNeedles = override
        ? [...new Set([companyName, override.canonical_name, ...override.aka])].map((n) => n.toLowerCase())
        : [companyName.toLowerCase()];

      // Matched on the UEI when the name resolves to one (launch fix 17).
      // Falls back to the name if the UEI search returns nothing, so a
      // lookup quirk can't cost a report the awards it found before.
      let ueis = await this.resolveUeis(searchName, acceptedNeedles);
      const search = (text: string[]) => Promise.all([
        this.searchByType(text, CONTRACT_TYPE_CODES),
        this.searchByType(text, GRANT_TYPE_CODES),
      ]);
      let [contracts, grants] = await search(ueis.length ? ueis : [searchName]);
      if (ueis.length && contracts.length + grants.length === 0) {
        ueis = [];
        [contracts, grants] = await search([searchName]);
      }
      const results = [...contracts, ...grants];

      console.log(`[usaspending-agent] "${companyName}"${searchName !== companyName ? ` (searched as "${searchName}")` : ""}: ${contracts.length} contract result(s), ${grants.length} grant result(s) before name-match filtering.`);

      // Guard against a loose recipient_search_text match returning
      // awards for an unrelated namesake — only keep results whose
      // recipient name contains the searched company name (or one of its
      // known aka/rename variants) as whole words.
      // With UEIs, an award's own UEI must be one of them; one without a
      // UEI field still has to match on the name.
      const filtered = results.filter((r) => {
        const uei = toStr(r["Recipient UEI"])?.toUpperCase();
        return ueis.length && uei ? ueis.includes(uei) : recipientMatches(toStr(r["Recipient Name"]), acceptedNeedles);
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
            url: `https://www.usaspending.gov/search/?hash=&recipient_search_text=${encodeURIComponent(ueis[0] ?? companyName)}`,
            title: `USASpending.gov — ${companyName}${ueis.length ? ` (UEI ${ueis.join(", ")})` : ""}`,
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
