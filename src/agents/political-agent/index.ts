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
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
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
 * Fetches full page text for the top results in every section (not just
 * snippets) — same pattern as people-agent/news-agent, and the fix for
 * the same class of "thin/stale snippet" accuracy problem. deep=true
 * (Charon Protocol, internal tier only — see orchestrator) pulls more
 * search results per query and fetches more pages per section, for a
 * materially more thorough pass.
 */
/**
 * Crude "Firstname Lastname" phrase matcher — good enough to spot which
 * real name is actually dominating a batch of search results.
 */
function extractNamePhrases(text: string): string[] {
  return text.match(/\b[A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+\b/g) ?? [];
}

/**
 * Guards against a fuzzy-matched wrong person. If the literal queried
 * name never appears anywhere in the gathered source text, that's a
 * strong signal the search engine substituted a different (if
 * similar-sounding) real person — e.g. querying "Bill Sherman" silently
 * returning results about Brad Sherman (D-CA), a 25+ year incumbent
 * with no name in common except the surname. Confidently synthesizing a
 * profile — worse, opposition-research allegations — under the wrong
 * name is a real accuracy/liability problem, not just a data-quality
 * one, so this returns a warning instead of a best-effort guess when it
 * can't confirm the sources are actually about the person asked for.
 */
function findNameMismatch(queryName: string, combinedText: string): string | undefined {
  const queryLower = queryName.toLowerCase().trim();
  if (combinedText.toLowerCase().includes(queryLower)) return undefined;

  const queryTokens = new Set(queryLower.split(/\s+/).filter((t) => t.length > 2));
  const tally = new Map<string, number>();
  for (const phrase of extractNamePhrases(combinedText)) {
    const tokens = phrase.toLowerCase().split(/\s+/);
    if (tokens.some((t) => queryTokens.has(t))) {
      tally.set(phrase, (tally.get(phrase) ?? 0) + 1);
    }
  }
  if (tally.size === 0) return `No source found that mentions "${queryName}" by name.`;

  const [closest] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return `No source mentions "${queryName}" by name — the closest match in results is "${closest}", which may be a different person.`;
}

export class PoliticalAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(name: string, deep = false): Promise<PoliticalAgentResult> {
    const resultCount = deep ? 10 : 5;
    const fullTextSourceCount = deep ? 3 : 2;
    const fullTextChars = deep ? 3000 : 2000;

    const queries = [
      `${name} congressional district party affiliation office incumbent`,
      `${name} district partisan lean demographics election results`,
      `${name} approval rating poll`,
      `${name} voting record key votes`,
      `${name} campaign finance donors fundraising FEC`,
      `${name} controversy criticism opposition record scandal`,
      // Political research fix #4/#5: same education signal person-agent
      // gathers for non-political people. Congress.gov's API doesn't
      // return education at all (confirmed against its actual response
      // shape — partyHistory/terms/state/district/chamber only), so
      // federal and state/local officials alike need this same
      // bio-extraction fallback rather than two different code paths.
      `${name} education college degree alma mater`,
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
      educationResults,
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
    tag(educationResults, "profile");

    // Fetch full page text for the top results in every section — richer
    // context than two-line snippets alone, same pattern as
    // people-agent/news-agent. Snippets stay in as backfill for the
    // sources that don't get fetched or fail to fetch.
    const sections: { label: string; results: typeof profileResults }[] = [
      { label: "PROFILE / OFFICE SEARCH", results: profileResults },
      { label: "DISTRICT SEARCH", results: districtResults },
      { label: "APPROVAL RATING SEARCH", results: approvalResults },
      { label: "VOTING RECORD SEARCH", results: votingResults },
      { label: "CAMPAIGN FINANCE SEARCH", results: financeResults },
      { label: "OPPOSITION RESEARCH SEARCH", results: oppoResults },
      { label: "EDUCATION SEARCH", results: educationResults },
    ];

    const sectionTexts = await Promise.all(
      sections.map(async ({ label, results }) => {
        if (results.length === 0) return "";
        const fetched = await Promise.all(
          results.slice(0, fullTextSourceCount).map((r) => fetchPageText(r.url, this.fetcher, fullTextChars))
        );
        const fullTextBlock = fetched
          .map((text, i) => (text ? `FULL PAGE (${results[i].url}):\n${text}` : ""))
          .filter(Boolean)
          .join("\n\n");
        // Snippets only for results that didn't get full text (past
        // fullTextSourceCount, or the fetch failed) — a source that's
        // already included as a full page doesn't need its own snippet
        // repeated right below it.
        const snippetBlock = results
          .filter((_r, i) => i >= fullTextSourceCount || !fetched[i])
          .map((r) => `${r.title}: ${r.snippet ?? ""}`)
          .join("\n");
        return [`${label}:`, fullTextBlock, snippetBlock].filter(Boolean).join("\n");
      })
    );

    const combinedText = sectionTexts.filter(Boolean).join("\n\n");

    const profile: PoliticalProfile = { name };
    let districtMakeup: DistrictMakeup | undefined;
    let approvalRating: ApprovalRating | undefined;
    let votingRecord: VotingRecordEntry[] = [];
    let campaignFinance: CampaignFinanceEntry[] = [];
    let oppositionResearch: OppositionResearchEntry[] = [];

    const nameMismatch = combinedText.length > 0 ? findNameMismatch(name, combinedText) : undefined;
    if (nameMismatch) {
      console.warn(`[political-agent] "${name}" — ${nameMismatch}`);
      profile.nameMismatchWarning = nameMismatch;
      profile.summary = `Could not confirm any gathered source is actually about "${name}". ${nameMismatch} No profile or opposition-research data was generated to avoid attributing another person's information to this name — double-check the spelling and re-run.`;
    } else if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a nonpartisan political research analyst compiling a factual briefing on "${name}" from search results.

CRITICAL RULES:
- Report facts as found in the source text. Do not editorialize, take a side, or use loaded language — this is a research briefing, not commentary.
- office/party/state/district: only if explicitly stated. Omit rather than guess.
- summary: 1-2 sentences — who they are, their current office/role, and their district or constituency if applicable.
- education: where they studied, what degree, if available (e.g. "JD, Harvard Law School") — only from source text, omit rather than guess.
- districtPartisanLean: e.g. "R+8", "D+12", "Toss-up" — only if a specific rating is mentioned in the source text.
- districtDemographics: brief factual description (urban/suburban/rural mix, notable industries) — only from source text.
- approvalRating: report the specific number(s) found (e.g. "44% approve / 49% disapprove"), which poll/pollster, and roughly when. Omit if no specific poll is mentioned — do not estimate.
- votingRecord: specific named bills/legislation with how they voted. Only votes explicitly mentioned in source text.
- campaignFinance: fundraising totals, donor composition, by election cycle if stated.
- oppositionResearch: an array of {topic, finding, severity}. Each entry is a specific, sourced, factual finding — a controversy, inconsistency, notable vote, financial conflict, past statement, etc. severity is "high"/"medium"/"low" based on how significant the finding is. Do NOT invent findings — only include what the source text actually supports. It is fine to return an empty array if nothing substantive is in the source text.
- CRITICAL for oppositionResearch specifically: this is the highest-risk section in this report — a wrong or misattributed finding here is a real reputational/accuracy problem, not just a data gap. Only include a finding if the source text explicitly names "${name}" (not a different, similarly-named person) in direct connection with that specific finding. If a source discusses someone with a similar-sounding but different name, or doesn't clearly tie the finding to "${name}" specifically, omit it — do not include it "in case it's relevant."
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
        if (llmResult.education) profile.education = llmResult.education;

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
    // than returning a blank profile. Skipped on a name mismatch — that
    // profile.summary is already the warning message, not a gap to fill.
    if (!profile.summary && !nameMismatch && profileResults[0]?.snippet) {
      profile.summary = profileResults[0].snippet;
    }

    // Suppress "Recent News" too on a name mismatch — those headlines
    // are just as likely to be about the wrong person as anything else
    // pulled from this batch of search results.
    const news: NewsEntry[] = nameMismatch
      ? []
      : oppoResults.slice(0, 5).map((r) => ({
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
