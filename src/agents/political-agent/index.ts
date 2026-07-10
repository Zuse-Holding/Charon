import {
  ApprovalRating,
  CampaignFinanceEntry,
  DistrictMakeup,
  NewsEntry,
  OppositionResearchEntry,
  PoliticalAgentResult,
  PoliticalProfile,
  Source,
  VotingRecordEntry,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { PoliticalExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * Political Research Agent (Round 2, item 1)
 *
 * Covers: candidate/incumbent profile, congressional district makeup,
 * approval ratings, voting record, campaign finance, and opposition
 * research.
 *
 * Sourcing: same pattern as every other agent in this codebase —
 * search-and-synthesize via the existing SearchProvider (Serper) and
 * extractStructured (Groq/OpenRouter/Ollama), not a dedicated FEC/
 * Congress.gov/Census API integration. Those APIs would give more
 * authoritative structured data (FEC filings especially), but each
 * requires its own API key sign-up that isn't provisioned in this repo
 * yet — see the note at the bottom of this file for what a v2 would
 * swap in. This gets real, useful output today with zero new credentials.
 *
 * deep=true (Jackal Protocol, internal tier only — see orchestrator)
 * pulls more search results per query and fetches full page text for
 * the top opposition-research sources instead of relying on snippets
 * alone, for a materially more thorough pass.
 */
export class PoliticalAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(name: string, deep = false): Promise<PoliticalAgentResult> {
    const resultCount = deep ? 10 : 5;

    const queries = [
      `${name} congressional district party affiliation office incumbent`,
      `${name} district partisan lean demographics election results`,
      `${name} approval rating poll`,
      `${name} voting record key votes`,
      `${name} campaign finance donors fundraising FEC`,
      `${name} controversy criticism opposition record scandal`,
    ];

    const searchResults = await Promise.all(
      queries.map((q) => this.searcher.search(q, resultCount))
    );

    const [
      profileResults,
      districtResults,
      approvalResults,
      votingResults,
      financeResults,
      oppoResults,
    ] = searchResults;

    const sources: Source[] = [];
    const tag = (results: typeof profileResults, usedFor: string) => {
      for (const r of results) {
        sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] });
      }
    };
    tag(profileResults, "profile");
    tag(districtResults, "district");
    tag(approvalResults, "approval");
    tag(votingResults, "voting-record");
    tag(financeResults, "campaign-finance");
    tag(oppoResults, "opposition-research");

    // Deep mode: fetch full page text for the top opposition-research
    // sources rather than relying on two-line snippets — this is the
    // section where source depth matters most for accuracy.
    let oppoFullText = "";
    if (deep && oppoResults.length > 0) {
      const pages = await Promise.all(
        oppoResults.slice(0, 3).map((r) => this.fetcher.fetchText(r.url).catch(() => null))
      );
      oppoFullText = pages
        .map((text, i) => (text ? `FULL PAGE (${oppoResults[i].url}):\n${text.slice(0, 3000)}` : ""))
        .filter(Boolean)
        .join("\n\n");
    }

    const combinedText = [
      profileResults.length ? `PROFILE / OFFICE SEARCH:\n${profileResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      districtResults.length ? `DISTRICT SEARCH:\n${districtResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      approvalResults.length ? `APPROVAL RATING SEARCH:\n${approvalResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      votingResults.length ? `VOTING RECORD SEARCH:\n${votingResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      financeResults.length ? `CAMPAIGN FINANCE SEARCH:\n${financeResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      oppoResults.length ? `OPPOSITION RESEARCH SEARCH:\n${oppoResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}` : "",
      oppoFullText,
    ].filter(Boolean).join("\n\n");

    const profile: PoliticalProfile = { name };
    let districtMakeup: DistrictMakeup | undefined;
    let approvalRating: ApprovalRating | undefined;
    let votingRecord: VotingRecordEntry[] = [];
    let campaignFinance: CampaignFinanceEntry[] = [];
    let oppositionResearch: OppositionResearchEntry[] = [];

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a nonpartisan political research analyst compiling a factual briefing on "${name}" from search results.

CRITICAL RULES:
- Report facts as found in the source text. Do not editorialize, take a side, or use loaded language — this is a research briefing, not commentary.
- office/party/state/district: only if explicitly stated. Omit rather than guess.
- summary: 1-2 sentences — who they are, their current office/role, and their district or constituency if applicable.
- districtPartisanLean: e.g. "R+8", "D+12", "Toss-up" — only if a specific rating is mentioned in the source text.
- districtDemographics: brief factual description (urban/suburban/rural mix, notable industries) — only from source text.
- approvalRating: report the specific number(s) found (e.g. "44% approve / 49% disapprove"), which poll/pollster, and roughly when. Omit if no specific poll is mentioned — do not estimate.
- votingRecord: specific named bills/legislation with how they voted. Only votes explicitly mentioned in source text.
- campaignFinance: fundraising totals, donor composition, by election cycle if stated.
- oppositionResearch: an array of {topic, finding, severity}. Each entry is a specific, sourced, factual finding — a controversy, inconsistency, notable vote, financial conflict, past statement, etc. severity is "high"/"medium"/"low" based on how significant the finding is. Do NOT invent findings — only include what the source text actually supports. It is fine to return an empty array if nothing substantive is in the source text.
- Every field must be traceable to the provided source text. Do not use outside knowledge to fill gaps.`,
        combinedText,
        PoliticalExtractionSchema
      );

      if (llmResult) {
        if (llmResult.office) profile.office = llmResult.office;
        if (llmResult.party) profile.party = llmResult.party;
        if (llmResult.state) profile.state = llmResult.state;
        if (llmResult.district) profile.district = llmResult.district;
        if (llmResult.summary) profile.summary = llmResult.summary;

        if (llmResult.districtPartisanLean || llmResult.districtDemographics || llmResult.districtKeyIssues) {
          districtMakeup = {
            partisanLean: llmResult.districtPartisanLean,
            demographics: llmResult.districtDemographics,
            keyIssues: llmResult.districtKeyIssues,
          };
        }

        if (llmResult.approvalValue) {
          approvalRating = {
            value: llmResult.approvalValue,
            source: llmResult.approvalSource,
            asOf: llmResult.approvalAsOf,
          };
        }

        votingRecord = llmResult.votingRecord;
        campaignFinance = llmResult.campaignFinance;
        oppositionResearch = llmResult.oppositionResearch;
      }
    }

    // Best-effort description fallback if the LLM call failed entirely —
    // matches the pattern every other agent in this codebase uses rather
    // than returning a blank profile.
    if (!profile.summary && profileResults[0]?.snippet) {
      profile.summary = profileResults[0].snippet;
    }

    const news: NewsEntry[] = oppoResults.slice(0, 5).map((r) => ({
      headline: r.title,
      summary: r.snippet,
      url: r.url,
    }));

    return {
      profile,
      districtMakeup,
      approvalRating,
      votingRecord,
      campaignFinance,
      oppositionResearch,
      news,
      sources,
    };
  }
}

/**
 * v2 upgrade path, not built here — swap search-and-synthesize for
 * authoritative structured sources once keys are provisioned:
 *   - FEC filings/campaign finance: api.open.fec.gov (free, needs an
 *     api.data.gov key)
 *   - Voting record: ProPublica Congress API or Congress.gov API (both
 *     free, both need a sign-up key)
 *   - District demographics: Census Bureau API (free, needs a key)
 * The extraction schema (PoliticalExtractionSchema in src/lib/llm.ts)
 * is shaped to match what those APIs would return, so wiring them in
 * later means adding a fetch call per source, not redesigning the type.
 */
