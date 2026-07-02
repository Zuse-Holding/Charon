import {
  CareerEntry,
  NewsEntry,
  PersonAgentResult,
  PersonProfile,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { extractRoleAndCompany, splitSentences } from "../../lib/nlp.js";
import { PersonExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * People Agent
 * Collects: current role/company, best-effort career history, recent
 * news mentions for a named individual.
 * Now fetches full bio pages for richer context — fixes the "wrong CEO"
 * issue caused by stale snippets.
 */
export class PeopleAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(personName: string): Promise<PersonAgentResult> {
    const currentYear = new Date().getFullYear();
    const [bioResults, newsResults] = await Promise.all([
      this.searcher.search(`${personName} current role position ${currentYear}`, 5),
      this.searcher.search(`${personName} news ${currentYear}`, 5),
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

    // Fetch full text from top 2 bio results for richer career context
    const fetchedBios = await Promise.all(
      bioResults.slice(0, 2).map(r => fetchPageText(r.url, this.fetcher, 2500))
    );

    const snippetText = bioResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const combinedText = [
      ...fetchedBios
        .filter((t): t is string => t !== null)
        .map((t, i) => `SOURCE (${bioResults[i].url}):\n${t}`),
      `SNIPPETS:\n${snippetText}`,
    ].filter(Boolean).join("\n\n") || snippetText;

    let usedLLM = false;
    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a research assistant extracting career and biographical facts about "${personName}" from search results. Today's year is ${currentYear}.

RULES:
- currentRole and currentCompany must reflect their MOST RECENT position as of ${currentYear}. If sources conflict, prefer the most recently dated source.
- If you see a past role mentioned (e.g. "former CEO") do NOT list it as the current role
- careerHistory should be in reverse chronological order (most recent first)
- summary should be 1-2 sentences maximum, factual only
- If you cannot confidently determine the current role from the sources, leave currentRole blank rather than guessing`,
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
