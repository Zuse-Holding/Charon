import { FecCandidateSummary, FecDonorBreakdownEntry, Source } from "../../types/research.js";

/**
 * OpenFEC Agent (Round 2 v2) — real campaign finance data from the
 * Federal Election Commission's public API (api.open.fec.gov).
 *
 * Requires OPENFEC_API_KEY (free, instant signup via api.data.gov).
 * Federal candidates only — state-level candidates aren't in FEC data.
 *
 * Flow: resolve a candidate_id from the name via /candidates/search/,
 * then pull the latest cycle's financial totals and a top-donor-by-
 * employer breakdown for that candidate. Every step is independently
 * try/caught — a failure at any point returns whatever was already
 * gathered rather than throwing, same pattern as every other agent here.
 */

const FEC_BASE = "https://api.open.fec.gov/v1";

interface FecCandidateSearchResult {
  candidate_id: string;
  name: string;
  party_full?: string;
}

interface FecTotalsResult {
  cycle?: number | null;
  receipts?: number;
  disbursements?: number;
  cash_on_hand_end_period?: number;
  // Confirmed in production: for a currently-serving member not yet in
  // an active election cycle, `cycle` comes back null. This field was
  // present in that same response and is arguably more useful anyway —
  // it says which election the money's being raised toward.
  candidate_election_year?: number;
}

interface FecEmployerResult {
  employer?: string;
  total?: number;
}

function formatUsd(n: unknown): string | undefined {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return undefined;
  return `$${num.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export class OpenFecAgent {
  private apiKey = process.env.OPENFEC_API_KEY;

  async run(name: string): Promise<{
    summary?: FecCandidateSummary;
    donorBreakdown: FecDonorBreakdownEntry[];
    sources: Source[];
  }> {
    if (!this.apiKey) return { donorBreakdown: [], sources: [] };

    try {
      const searchRes = await fetch(
        `${FEC_BASE}/candidates/search/?q=${encodeURIComponent(name)}&api_key=${this.apiKey}&sort=-election_years&per_page=5`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!searchRes.ok) {
        console.warn(`[openfec-agent] "${name}" — candidate search HTTP ${searchRes.status}`);
        return { donorBreakdown: [], sources: [] };
      }

      const searchData = (await searchRes.json()) as { results?: FecCandidateSearchResult[] };
      const candidate = (searchData.results ?? [])[0];
      if (!candidate) {
        console.warn(`[openfec-agent] "${name}" — no FEC candidate match (state/local candidates aren't in FEC data)`);
        return { donorBreakdown: [], sources: [] };
      }

      const [totalsRes, employerRes] = await Promise.all([
        fetch(
          `${FEC_BASE}/candidate/${candidate.candidate_id}/totals/?api_key=${this.apiKey}&sort=-cycle&per_page=1`,
          { signal: AbortSignal.timeout(15_000) }
        ).catch((err) => {
          console.warn(`[openfec-agent] "${name}" — totals request failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
        fetch(
          `${FEC_BASE}/schedules/schedule_a/by_employer/?candidate_id=${candidate.candidate_id}&api_key=${this.apiKey}&sort=-total&per_page=8`,
          { signal: AbortSignal.timeout(15_000) }
        ).catch((err) => {
          console.warn(`[openfec-agent] "${name}" — donor-by-employer request failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
      ]);

      let summary: FecCandidateSummary = {
        candidateId: candidate.candidate_id,
        name: candidate.name,
        party: candidate.party_full,
      };

      if (totalsRes?.ok) {
        const totalsData = (await totalsRes.json()) as { results?: FecTotalsResult[] };
        const latest = (totalsData.results ?? [])[0];
        if (latest) {
          summary = {
            ...summary,
            cycle: latest.cycle ? String(latest.cycle) : latest.candidate_election_year ? String(latest.candidate_election_year) : undefined,
            totalReceipts: formatUsd(latest.receipts),
            totalDisbursements: formatUsd(latest.disbursements),
            cashOnHand: formatUsd(latest.cash_on_hand_end_period),
          };
          // cashOnHand specifically is still unconfirmed — the raw dump
          // that caught the "cycle" bug got truncated at 500 chars
          // before reaching that field. Un-truncated this time, and
          // checked independently of cycle (which now has a fallback
          // and would otherwise mask this warning going forward).
          if (!summary.cashOnHand) {
            console.warn(`[openfec-agent] "${name}" — totals result missing "cash_on_hand_end_period", raw object: ${JSON.stringify(latest)}`);
          }
        }
      } else if (totalsRes && !totalsRes.ok) {
        console.warn(`[openfec-agent] "${name}" — totals HTTP ${totalsRes.status}`);
      }

      let donorBreakdown: FecDonorBreakdownEntry[] = [];
      if (employerRes?.ok) {
        const employerData = (await employerRes.json()) as { results?: FecEmployerResult[] };
        donorBreakdown = (employerData.results ?? [])
          .filter((r): r is { employer: string; total: number } => Boolean(r.employer) && typeof r.total === "number")
          .map((r) => ({ employer: r.employer, total: formatUsd(r.total) as string }));
      } else if (employerRes && !employerRes.ok) {
        console.warn(`[openfec-agent] "${name}" — donor-by-employer HTTP ${employerRes.status}`);
      }

      const sources: Source[] = [{
        url: `https://www.fec.gov/data/candidate/${candidate.candidate_id}/`,
        title: `FEC — ${candidate.name}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["campaign-finance"],
      }];

      console.log(`[openfec-agent] "${name}" — resolved candidate_id=${candidate.candidate_id}, cycle=${summary.cycle ?? "?"}, receipts=${summary.totalReceipts ?? "?"}, ${donorBreakdown.length} donor-employer entries`);

      return { summary, donorBreakdown, sources };
    } catch (err) {
      console.warn(`[openfec-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { donorBreakdown: [], sources: [] };
    }
  }
}
