import { DeepDiveBundle, DeepDiveSection, RiskLevel } from "../../types/research.js";
import { FetchProvider, SearchProvider, resolveAndFetch, htmlToText } from "../../lib/providers.js";
import { extractStructured } from "../../lib/llm.js";
import { SECTION_ORDER, SECTION_ESTIMATES, TOTAL_ESTIMATED_SECONDS } from "../../lib/deep-dive-constants.js";
import { z } from "zod";

export { SECTION_ORDER, SECTION_ESTIMATES, TOTAL_ESTIMATED_SECONDS };

export type ProgressCallback = (event: ProgressEvent) => void;

export interface ProgressEvent {
  type: "section_start" | "section_done" | "complete" | "error";
  section?: string;
  sectionIndex?: number;
  totalSections: number;
  content?: string;
  error?: string;
}

const SectionSchema = z.object({
  content: z.string().min(1),
  riskLevel: z.enum(["high", "medium", "low"]).optional(),
});

type SectionResult = z.infer<typeof SectionSchema>;

export class DeepDiveAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  /** Fetches multiple search results and optionally the first full page. */
  private async gather(queries: string[], fetchFirst = false): Promise<string> {
    const allResults = await Promise.all(
      queries.map(q => this.searcher.search(q, 4))
    );
    const flat = allResults.flat();

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = flat.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    let pageText = "";
    if (fetchFirst && unique.length > 0) {
      try {
        const res = await this.fetcher.fetchText(unique[0].url);
        if (res) pageText = `\nFULL PAGE (${unique[0].url}):\n${htmlToText(res).slice(0, 3000)}`;
      } catch { /* ignore fetch failures */ }
    }

    const snippets = unique
      .slice(0, 8)
      .map(r => `SOURCE: ${r.title}\nURL: ${r.url}\n${r.snippet ?? ""}`)
      .join("\n\n");

    return snippets + pageText;
  }

  /** Calls the LLM to synthesize a section from gathered text. */
  private async synthesize(
    company: string,
    sectionTitle: string,
    prompt: string,
    context: string
  ): Promise<SectionResult> {
    const result = await extractStructured(
      `You are a senior business analyst writing the "${sectionTitle}" section of a professional deep dive report on ${company}.

${prompt}

REQUIREMENTS:
- Write in professional analyst prose, not bullet points
- Be specific — cite actual numbers, names, and dates from the sources
- If data is missing or unclear, say so explicitly rather than speculating
- Length: 150-300 words for this section
- Return JSON with a "content" field containing your markdown prose
- For Risk Flags only: also return a "riskLevel" field ("high", "medium", or "low") for each flag`,
      `RESEARCH DATA:\n\n${context}`,
      SectionSchema
    );

    if (result) return result;

    // Heuristic fallback if LLM fails
    return {
      content: `_Analysis unavailable for this section — LLM synthesis failed. Raw research data gathered but could not be processed. Re-run the deep dive to retry._`,
    };
  }

  async run(
    companyName: string,
    onProgress: ProgressCallback
  ): Promise<DeepDiveBundle> {
    const startTime = Date.now();
    const sections: DeepDiveSection[] = [];

    // Accumulated context — passed to later synthesis-only sections
    // so they can reason across everything gathered so far.
    let accumulatedContext = "";

    const runSection = async (
      title: string,
      index: number,
      searchQueries: string[],
      synthesisPrompt: string,
      useFetch = false,
      useAccumulated = false
    ) => {
      onProgress({
        type: "section_start",
        section: title,
        sectionIndex: index,
        totalSections: SECTION_ORDER.length,
      });

      const rawContext = searchQueries.length > 0
        ? await this.gather(searchQueries, useFetch)
        : "";

      const context = useAccumulated
        ? `${accumulatedContext}\n\n---\nADDITIONAL RESEARCH:\n${rawContext}`
        : rawContext;

      const result = await this.synthesize(companyName, title, synthesisPrompt, context);
      accumulatedContext += `\n\n=== ${title.toUpperCase()} ===\n${result.content}`;

      const section: DeepDiveSection = {
        title,
        content: result.content,
        riskLevel: result.riskLevel as RiskLevel | undefined,
      };
      sections.push(section);

      onProgress({
        type: "section_done",
        section: title,
        sectionIndex: index,
        totalSections: SECTION_ORDER.length,
        content: result.content,
      });
    };

    try {
      // 1. Executive Brief
      await runSection(
        "Executive Brief",
        0,
        [
          `${companyName} company overview what do they do`,
          `${companyName} business model revenue`,
        ],
        `Write a crisp 2-paragraph executive brief covering: what ${companyName} does, who they serve, what problem they solve, and why it matters. End with one sentence on the overall opportunity or risk for someone evaluating this company.`
      );

      // 2. Founding & History
      await runSection(
        "Founding & History",
        1,
        [
          `${companyName} founding story history`,
          `${companyName} founded when who origin`,
          `${companyName} company milestones timeline`,
        ],
        `Write a narrative of ${companyName}'s history: when and why it was founded, who the founders are and their backgrounds, key pivots or inflection points, and how the company has evolved. Include specific dates and events where available.`
      );

      // 3. Leadership Deep Dive
      await runSection(
        "Leadership Deep Dive",
        2,
        [
          `${companyName} CEO founder background career`,
          `${companyName} executive team leadership`,
          `${companyName} management team experience`,
        ],
        `Profile the key executives at ${companyName}. For each person: their name and role, relevant prior experience, notable achievements, and any red flags (frequent job changes, failed ventures, legal issues). Assess overall leadership quality and team completeness.`,
        true
      );

      // 4. Funding & Financials
      await runSection(
        "Funding & Financials",
        3,
        [
          `${companyName} funding rounds raised investors`,
          `${companyName} valuation worth`,
          `${companyName} revenue financials annual`,
          `${companyName} Series funding Crunchbase`,
        ],
        `Detail ${companyName}'s financial history: all known funding rounds (amount, date, lead investors), current valuation, any revenue figures or estimates, burn rate signals, and what the capital has been used for. Assess financial health and runway.`
      );

      // 5. Products & Traction
      await runSection(
        "Products & Traction",
        4,
        [
          `${companyName} products services pricing`,
          `${companyName} customers users reviews`,
          `${companyName} growth metrics traffic`,
          `${companyName} Trustpilot G2 reviews rating`,
        ],
        `Analyze ${companyName}'s product portfolio: what they offer, how it's priced, who the target customer is, and evidence of traction (user counts, revenue signals, review scores, growth indicators). Note any product gaps or quality concerns.`,
        true
      );

      // 6. Risk Flags (synthesis — no new searches)
      await runSection(
        "Risk Flags",
        5,
        [],
        `Based on everything gathered about ${companyName}, identify 3-5 specific risk flags. For each flag: name it clearly, explain the specific evidence, and rate its severity. Be concrete — reference actual facts from the research, not generic business risks. Return with a riskLevel of "high", "medium", or "low" for the overall risk profile.`,
        false,
        true
      );

      // 7. Competitive Context
      await runSection(
        "Competitive Context",
        6,
        [
          `${companyName} competitors comparison`,
          `${companyName} vs competitors market position`,
          `${companyName} competitive advantage differentiation`,
        ],
        `Map ${companyName}'s competitive position: who the main competitors are, how ${companyName} differentiates, where they're stronger or weaker, and what the competitive dynamics look like. Name specific competitors and make direct comparisons where possible.`
      );

      // 8. Market Sizing
      await runSection(
        "Market Sizing",
        7,
        [
          `${companyName} market size industry`,
          `${companyName} total addressable market TAM`,
          `market size ${companyName} sector billion`,
        ],
        `Estimate the market opportunity for ${companyName}: total addressable market (TAM), serviceable addressable market (SAM), and realistic serviceable obtainable market (SOM). Cite sources for any figures. Assess whether the market is growing, contracting, or stable.`
      );

      // 9. Strategic Options (synthesis)
      await runSection(
        "Strategic Options",
        8,
        [],
        `Based on everything gathered, analyze four strategic options for someone evaluating ${companyName}: (1) Acquire — full or asset acquisition, (2) Partner — integration or distribution partnership, (3) Compete — build a competing offering, (4) Invest — minority stake. For each option: key pros, key cons, and what would need to be true for it to make sense. Be specific to ${companyName}'s actual situation.`,
        false,
        true
      );

      // 10. Verdict
      await runSection(
        "Verdict",
        9,
        [],
        `Write a clear strategic verdict on ${companyName} in 2-3 paragraphs. Lead with a direct recommendation (which strategic option makes most sense and why). Support it with the 2-3 strongest pieces of evidence from the research. Close with the 1-2 things that would most change this assessment if they turned out to be different than assumed. This should read like the final page of a McKinsey deck — direct, confident, evidence-based.`,
        false,
        true
      );

      const bundle: DeepDiveBundle = {
        id: `dd-${Date.now()}`,
        company: companyName,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        sections,
      };

      onProgress({
        type: "complete",
        totalSections: SECTION_ORDER.length,
      });

      return bundle;

    } catch (err) {
      onProgress({
        type: "error",
        totalSections: SECTION_ORDER.length,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
