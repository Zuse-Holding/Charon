import {
  CareerEntry,
  NewsEntry,
  PersonAgentResult,
  PersonProfile,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";
import { extractRoleAndCompany, splitSentences } from "../../lib/nlp.js";
import { PersonExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * People Agent
 * Collects: current role/company, best-effort career history, recent
 * news mentions for a named individual.
 *
 * Tries a local LLM (Ollama) first for the bio/role/career fields —
 * generalizes across phrasing the regex patterns weren't written for.
 * Falls back to sentence-scoped regex extraction (lib/nlp.ts) if Ollama
 * isn't available.
 */
export class PeopleAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(personName: string): Promise<PersonAgentResult> {
    const [bioResults, newsResults] = await Promise.all([
      this.searcher.search(`${personName} biography current role`, 5),
      this.searcher.search(`${personName} news`, 5),
    ]);

    const sources: Source[] = [
      ...bioResults.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["bio"],
      })),
      ...newsResults.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["news"],
      })),
    ];

    const person: PersonProfile = { name: personName };
    let careerHistory: CareerEntry[] = [];

    const combinedText = bioResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    let usedLLM = false;
    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a research assistant extracting career/bio facts about the person "${personName}" from search results.`,
        combinedText,
        PersonExtractionSchema
      );

      if (llmResult) {
        usedLLM = true;
        if (llmResult.summary) person.summary = llmResult.summary;
        if (llmResult.currentRole) person.currentRole = llmResult.currentRole;
        if (llmResult.currentCompany) person.currentCompany = llmResult.currentCompany;
        if (llmResult.careerHistory) {
          careerHistory = llmResult.careerHistory.map((c) => ({
            title: c.title,
            company: c.company,
          }));
        }
      }
    }

    if (!usedLLM || (!person.currentRole && careerHistory.length === 0)) {
      const seenRoles = new Set<string>();
      for (const r of bioResults) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        const sentences = splitSentences(text);

        for (const sentence of sentences) {
          const match = extractRoleAndCompany(sentence);
          if (!match) continue;

          const key = `${match.role.toLowerCase()}-${match.company.toLowerCase()}`;
          if (seenRoles.has(key)) continue;
          seenRoles.add(key);

          careerHistory.push({ title: match.role, company: match.company });

          if (!person.currentRole) {
            person.currentRole = match.role;
            person.currentCompany = match.company;
          }
        }

        if (
          !person.summary &&
          r.snippet
            ?.toLowerCase()
            .includes(personName.toLowerCase().split(" ")[0])
        ) {
          const s = r.snippet.trim();
          person.summary = s.length <= 500 ? s : s.slice(0, 500).replace(/[^.!?]*$/, "").trim();
        }
      }
    }

    const news: NewsEntry[] = newsResults.map((r) => ({
      headline: r.title,
      summary: r.snippet,
      url: r.url,
    }));

    return { person, careerHistory, news, sources };
  }
}
