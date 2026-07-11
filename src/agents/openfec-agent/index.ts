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
  cycle?: number;
  receipts?: number;
  disbursements?: number;
  cash_on_hand_end_period?: number;
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
            cycle: latest.cycle ? String(latest.cycle) : undefined,
            totalReceipts: formatUsd(latest.receipts),
            totalDisbursements: formatUsd(latest.disbursements),
            cashOnHand: formatUsd(latest.cash_on_hand_end_period),
          };
          // Confirmed in production: receipts resolves fine but cycle
          // sometimes doesn't, meaning the assumed field name isn't
          // quite right for every response shape. Rather than guess
          // again blind, dump the raw object once so the next run shows
          // exactly what's actually there.
          if (!summary.cycle) {
            console.warn(`[openfec-agent] "${name}" — totals result missing "cycle", raw object: ${JSON.stringify(latest).slice(0, 500)}`);
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
