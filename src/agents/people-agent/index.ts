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
import { isNewsNoise, isUsableHeadline, mentionsPerson } from "../../lib/news-noise.js";
import { mentionsAffiliation } from "../../lib/entities/affiliation.js";

// Placeholder employers the extractor sometimes fills in ("Actor at
// Various") instead of leaving the field out.
const PLACEHOLDER_ORG = /^(various|various companies|multiple|several|n\/a|na|unknown|none|not specified|unspecified)$/i;

export function isPlaceholderOrg(company: string | undefined): boolean {
  return !!company && PLACEHOLDER_ORG.test(company.trim());
}
import {
  appendDomainExclusions,
  findOverride,
  isRejectedDomain,
  resolveCompanyNameAsPerson,
} from "../../entity-validation.js";

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

  /**
   * @param deep Charon Protocol (internal tier, no daily/monthly limits —
   *   see server/agent-server.ts). Pulls more results per query and reads
   *   full page text from more bio sources instead of snippets alone.
   *   Same extraction pipeline either way, just more raw material for it.
   * @param affiliation Optional school/employer/org parsed out of the raw
   *   query (see parsePersonQuery in src/lib/nlp.ts) — e.g. "csun" from
   *   "Daniel Olmos csun". `personName` itself is already the clean name
   *   by the time it reaches here; affiliation is folded back into the
   *   search queries (still useful context for disambiguating a common
   *   name) and the extraction prompt, and used to prioritize which
   *   sources get treated as authoritative when several show up.
   */
  async run(personName: string, deep = false, affiliation?: string): Promise<PersonAgentResult> {
    // Guard against a company name literally routed into person search
    // (e.g. "Alan Health" run with the Person type selected). Without
    // this, the searches below go out as a blind "Alan Health ..." query
    // with no domain filtering, and just as easily surface an unrelated
    // same-first-name person at an unrelated health company as the real
    // one — the entity-validation registry already knows "Alan Health"
    // resolves to a company with a known CEO, so redirect to that person
    // instead of searching the literal company name as if it were one.
    const companyOverride = resolveCompanyNameAsPerson(personName);
    if (companyOverride?.ceo) {
      personName = companyOverride.ceo;
    }
    // Also covers prefix/aka matches (e.g. "Alan Health Technologies")
    // so domain exclusions apply even when the literal-name redirect
    // above didn't fire — same pattern as corporate-agent's 7/20 fix.
    const override = findOverride(personName) ?? companyOverride;

    const currentYear = new Date().getFullYear();
    const resultCount = deep ? 10 : 5;
    const bgResultCount = deep ? 8 : 4;
    const fullTextSourceCount = deep ? 4 : 2;
    const fullTextChars = deep ? 4000 : 2500;

    // Search with affiliation appended when present — same disambiguation
    // value a human researcher gets from typing "Daniel Olmos csun" into
    // Google, even though the stored/displayed name stays just "Daniel Olmos".
    const searchSubject = affiliation ? `${personName} ${affiliation}` : personName;

    const [bioResultsRaw, newsResultsRaw, backgroundResultsRaw] = await Promise.all([
      this.searcher.search(appendDomainExclusions(`${searchSubject} current role position ${currentYear}`, override), resultCount),
      // Twice the results needed: social, forum and tag-index pages are dropped below.
      this.searcher.search(appendDomainExclusions(`${searchSubject} news ${currentYear}`, override), resultCount * 2),
      this.searcher.search(appendDomainExclusions(`${searchSubject} education net worth background biography`, override), bgResultCount),
    ]);

    // Never merge candidates (Fix 5): a source must name this person, and
    // the affiliation when one was given. A same-named stranger's page is
    // dropped, not blended into the profile.
    // Employer variants count as one (round 2, Fix 2): "UCLA Health",
    // "UCLA" and "University of California, Los Angeles".
    const aboutThisPerson = (r: { title: string; snippet?: string }) => {
      const text = `${r.title} ${r.snippet ?? ""}`;
      return mentionsPerson(text, personName) && (!affiliation || mentionsAffiliation(text, affiliation));
    };
    const bioResults = bioResultsRaw.filter((r) => !isRejectedDomain(r.url, override) && aboutThisPerson(r));
    // News must have a real headline and name this person (and the
    // affiliation, when one was given): a same-name stranger's coverage
    // is worse than no news item.
    const newsResults = newsResultsRaw
      .filter((r) => !isRejectedDomain(r.url, override) && !isNewsNoise(r.url))
      .filter((r) => isUsableHeadline(r.title) && aboutThisPerson(r))
      .slice(0, resultCount);
    const backgroundResults = backgroundResultsRaw.filter((r) => !isRejectedDomain(r.url, override) && aboutThisPerson(r));

    const sources: Source[] = [
      ...bioResults.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["bio"],
      })),
      ...backgroundResults.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["background"],
      })),
      ...newsResults.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["news"],
      })),
    ];

    const person: PersonProfile = { name: personName, ...(affiliation ? { affiliation } : {}) };
    let careerHistory: CareerEntry[] = [];

    // Fetch full text from the top bio results for richer career context
    // (more sources + more chars per source in deep mode).
    const fetchedBios = await Promise.all(
      bioResults.slice(0, fullTextSourceCount).map(r => fetchPageText(r.url, this.fetcher, fullTextChars))
    );

    const snippetText = bioResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const backgroundText = backgroundResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const combinedText = [
      // Label before filtering: filtering first shifted every later page
      // onto the previous result's URL whenever one fetch failed.
      ...fetchedBios
        .map((t, i) => (t === null ? null : `SOURCE (${bioResults[i].url}):\n${t}`))
        .filter((t): t is string => t !== null),
      `CAREER SNIPPETS:\n${snippetText}`,
      `BACKGROUND & NET WORTH:\n${backgroundText}`,
    ].filter(Boolean).join("\n\n") || snippetText;

    let usedLLM = false;
    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a research assistant extracting biographical facts about "${personName}"${affiliation ? ` (search context: "${affiliation}", which may be an employer, school or location — use it to make sure you're extracting facts about the right person, not a same-named stranger)` : ""} from search results. Today's year is ${currentYear}.

Extract these fields:
- summary: 2-3 sentences describing who this person is, what they're known for, and why they matter. Write it like the opening of a Wikipedia article — specific, confident, factual. No filler.
- currentRole: their most recent job title as of ${currentYear}
- currentCompany: the organization they currently work for
- education: where they studied, what degree, if available (e.g. "BS Computer Science, Stanford")
- netWorth: estimated net worth if publicly available (e.g. "$4.5B as of 2024")
- knownFor: one sentence on what they're most notable for (invention, company, achievement, controversy)
- nationality: their nationality or country of origin if mentioned
- careerHistory: array of {title, company} in reverse chronological order (most recent first)

RULES:
- currentRole must reflect their position as of ${currentYear}. If a source says "former", do NOT list it as current.
- Take titles and roles only from what the text says about this person. Never infer them from a URL, domain, site name or page section (a profile hosted on a research office's site doesn't make someone that office's head).
- If you cannot confidently determine a field, omit it rather than guessing.
- Be specific — name actual companies, schools, dollar figures where available.
- Never include home or street addresses, phone numbers, personal email addresses or other contact details in any field, even if a source lists them. A city or region is fine only when it's part of who they are publicly (e.g. "Austin-based founder").
- Every careerHistory entry and currentCompany must name one real organization. Never use placeholders like "Various", "Multiple" or "N/A"; leave the entry out instead.
- Don't name a company someone merely worked with as their employer. A freelance actor, athlete or artist appearing in a studio's or brand's projects isn't employed by it; for them, omit currentCompany unless they actually hold a role there (owner, executive, signed team, etc.).`,
        combinedText,
        PersonExtractionSchema
      );

      if (llmResult) {
        usedLLM = true;
        if (llmResult.summary)        person.summary        = llmResult.summary;
        if (llmResult.currentRole)    person.currentRole    = llmResult.currentRole;
        if (llmResult.currentCompany && !isPlaceholderOrg(llmResult.currentCompany)) person.currentCompany = llmResult.currentCompany;
        if (llmResult.education)      person.education      = llmResult.education;
        if (llmResult.netWorth)       person.netWorth       = llmResult.netWorth;
        if (llmResult.knownFor)       person.knownFor       = llmResult.knownFor;
        if (llmResult.nationality)    person.nationality    = llmResult.nationality;
        if (llmResult.careerHistory) {
          careerHistory = llmResult.careerHistory
            .filter((c) => !isPlaceholderOrg(c.company))
            .map((c) => ({ title: c.title, company: c.company }));
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
