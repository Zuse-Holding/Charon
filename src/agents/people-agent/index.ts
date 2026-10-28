import {
  BoardSeatEntry,
  CareerEntry,
  NewsEntry,
  PersonAgentResult,
  PersonProfile,
  Source,
} from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText, htmlToText } from "../../lib/providers.js";
import { extractRoleAndCompany, splitSentences } from "../../lib/nlp.js";
import { PersonExtractionSchema, extractStructured } from "../../lib/llm.js";
import { isNewsNoise, isUsableHeadline, mentionsCompany, mentionsPerson } from "../../lib/news-noise.js";
import { mentionsAffiliation } from "../../lib/entities/affiliation.js";
import { applyRoleChange, personNews, roleFromNews, summaryFromSnippet } from "../../lib/person-checks.js";
import {
  bioExcerpt, clearEndedRole, confirmBoardSeats, isBoardPage, isProfilePage, officialBioPage, secPersonExcerpts,
  sourceOf, tiedToOrg, type SecExcerpt, type TiedText,
} from "../../lib/person-sources.js";

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

    // With an organization to tie them to (the picked match): the
    // executive bio on its own site, SEC proxy and 8-K text, other
    // companies' board pages, the picker's own search, and the
    // organization's news (Oct 27 handoff, fixes 2-5 and 8).
    const org = affiliation;
    const none = Promise.resolve([]);
    const [bioResultsRaw, newsResultsRaw, backgroundResultsRaw, profileResultsRaw, execBioResultsRaw, boardResultsRaw, companyNewsRaw, secExcerpts] = await Promise.all([
      this.searcher.search(appendDomainExclusions(`${searchSubject} current role position ${currentYear}`, override), resultCount),
      // Twice the results needed: social, forum and tag-index pages are dropped below.
      this.searcher.search(appendDomainExclusions(`${searchSubject} news ${currentYear}`, override), resultCount * 2),
      this.searcher.search(appendDomainExclusions(`${searchSubject} education net worth background biography`, override), bgResultCount),
      org ? this.searcher.search(appendDomainExclusions(`"${personName}" ${org}`, override), 10) : none,
      org ? this.searcher.search(`${personName} ${org} leadership bio`, resultCount) : none,
      org ? this.searcher.search(appendDomainExclusions(`"${personName}" board of directors`, override), resultCount * 2) : none,
      org ? this.searcher.search(`${org} news ${currentYear}`, resultCount * 2) : none,
      org ? secPersonExcerpts(personName, org).catch((err): SecExcerpt[] => {
        console.warn(`[people-agent] SEC lookup failed for "${personName}":`, err instanceof Error ? err.message : err);
        return [];
      }) : Promise.resolve([] as SecExcerpt[]),
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
    // Profile, bio and board pages say who someone is; they aren't news.
    const newsResults = newsResultsRaw
      .filter((r) => !isRejectedDomain(r.url, override) && !isNewsNoise(r.url) && !isProfilePage(r.url))
      .filter((r) => isUsableHeadline(r.title) && aboutThisPerson(r))
      .slice(0, resultCount);
    const backgroundResults = backgroundResultsRaw.filter((r) => !isRejectedDomain(r.url, override) && aboutThisPerson(r));
    // The picker's snippets carry facts (McCann's Drexel MBA) the other
    // searches can miss: they go to extraction too (fix 5).
    const known = new Set([...bioResults, ...backgroundResults].map((r) => r.url));
    const profileResults = profileResultsRaw.filter((r) => !known.has(r.url) && !isRejectedDomain(r.url, override) && aboutThisPerson(r));
    const officialBio = org ? officialBioPage([...execBioResultsRaw, ...bioResultsRaw, ...profileResultsRaw], personName, org) : undefined;
    const boardCandidates = boardResultsRaw
      .filter((r) => !isRejectedDomain(r.url, override) && r.url !== officialBio?.url && isBoardPage(r, personName))
      .slice(0, deep ? 4 : 3);
    const seenNews = new Set(newsResults.map((r) => r.url));
    const companyNewsResults = org
      ? companyNewsRaw
        .filter((r) => !seenNews.has(r.url) && !isNewsNoise(r.url) && !isProfilePage(r.url))
        .filter((r) => isUsableHeadline(r.title) && mentionsCompany(`${r.title}. ${r.snippet ?? ""}`, org))
      : [];

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
      ...profileResults.map((r) => sourceOf(r.url, r.title, "bio")),
      ...secExcerpts.map((e) => sourceOf(e.url, `${e.label}${e.date ? `, filed ${e.date}` : ""}`, "bio")),
    ];

    const person: PersonProfile = { name: personName, ...(affiliation ? { affiliation } : {}) };
    let careerHistory: CareerEntry[] = [];
    let boardSeats: BoardSeatEntry[] = [];

    // Fetch full text from the top bio results for richer career context
    // (more sources + more chars per source in deep mode). The official
    // bio and board pages are read whole and cut around the person: a
    // leadership or board page lists everyone.
    const pageText = async (url: string) => {
      const html = await this.fetcher.fetchText(url).catch(() => null);
      return html ? htmlToText(html) : null;
    };
    const [fetchedBios, officialText, boardTexts] = await Promise.all([
      Promise.all(bioResults.slice(0, fullTextSourceCount).map(r => fetchPageText(r.url, this.fetcher, fullTextChars))),
      officialBio ? pageText(officialBio.url) : Promise.resolve(null),
      Promise.all(boardCandidates.map((r) => pageText(r.url))),
    ]);
    const officialExcerpt = officialText && officialBio ? bioExcerpt(officialText, personName, 4000) : undefined;
    // A board page counts only when it also names the picked organization:
    // a name alone never confirms a record.
    const boardPages: TiedText[] = boardCandidates.flatMap((r, i) => {
      const text = boardTexts[i];
      if (!text || !org || !tiedToOrg(text, personName, org)) return [];
      const excerpt = bioExcerpt(text, personName, 1500);
      return excerpt ? [{ url: r.url, text: `${r.title}\n${excerpt}` }] : [];
    });
    if (officialExcerpt && officialBio && !sources.some((x) => x.url === officialBio.url)) sources.unshift(sourceOf(officialBio.url, officialBio.title, "bio"));
    for (const b of boardPages) sources.push(sourceOf(b.url, boardCandidates.find((r) => r.url === b.url)!.title, "board-seats"));

    const snippetText = bioResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const backgroundText = backgroundResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const profileText = profileResults
      .map((r) => `${r.title}: ${r.snippet ?? ""}`)
      .join("\n");

    const combinedText = [
      officialExcerpt && officialBio ? `OFFICIAL BIO on ${org}'s own site (${officialBio.url}):\n${officialExcerpt}` : "",
      ...secExcerpts.map((e) => `${e.label}${e.date ? `, filed ${e.date}` : ""} (${e.url}):\n${e.text}`),
      // Label before filtering: filtering first shifted every later page
      // onto the previous result's URL whenever one fetch failed.
      ...fetchedBios
        .map((t, i) => (t === null ? null : `SOURCE (${bioResults[i].url}):\n${t}`))
        .filter((t): t is string => t !== null),
      ...boardPages.map((b) => `BOARD PAGE (${b.url}):\n${b.text}`),
      `CAREER SNIPPETS:\n${snippetText}`,
      profileText ? `PROFILE SNIPPETS:\n${profileText}` : "",
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
- education: every degree stated, with school and year when given (e.g. "BSME, Worcester Polytechnic Institute; MBA, Drexel University")
- netWorth: estimated net worth if publicly available (e.g. "$4.5B as of 2024")
- knownFor: one sentence on what they're most notable for (invention, company, achievement, controversy)
- nationality: their nationality or country of origin if mentioned
- careerHistory: array of {title, company, start, end, current} in reverse chronological order (most recent first). start and end: the month and year when the text states them ("Mar 2023"), else the year; omit a date the text doesn't give. current: false when the text says the role ended or calls it former or previous; true only when the text says they hold it now. A board seat at their own employer (e.g. Chairman) is a careerHistory entry.
- boardSeats: array of {organization, role, start, end} for other organizations' boards (companies, associations, nonprofits) the text says this person sits or sat on. Never include their own employer here.
- announcedDeparture: one sentence, with the date, when the text says they announced they will leave or retire from a role they still hold.

RULES:
- currentRole must reflect their position as of ${currentYear}. If a source says "former", do NOT list it as current.
- An OFFICIAL BIO is the person's employer's own page and an SEC filing is sworn: prefer them for titles, dates, prior roles, education and directorships.
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
        if (llmResult.announcedDeparture) person.announcedDeparture = llmResult.announcedDeparture;
        if (llmResult.careerHistory) {
          careerHistory = llmResult.careerHistory
            .filter((c) => !isPlaceholderOrg(c.company))
            .map((c) => ({
              title: c.title, company: c.company,
              ...(c.start ? { start: c.start } : {}), ...(c.end ? { end: c.end } : {}),
              ...(c.current !== undefined ? { current: c.current } : {}),
            }));
        }
        // Only seats a source tied to this person names (board pages first,
        // so each seat cites its board's own page).
        const tied: TiedText[] = [
          ...boardPages,
          ...(officialExcerpt && officialBio ? [{ url: officialBio.url, text: officialExcerpt }] : []),
          ...secExcerpts.map((e) => ({ url: e.url, text: e.text })),
        ];
        boardSeats = confirmBoardSeats(
          llmResult.boardSeats.filter((b) => !isPlaceholderOrg(b.organization)),
          tied,
          [org, person.currentCompany].filter((e): e is string => !!e),
        );
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

        // One whole sentence that names this person, never the pasted
        // snippet (round 20, as ACCO's summary quoting Argan's 10-K).
        if (!person.summary) person.summary = summaryFromSnippet(r.snippet, personName);
      }
    }

    // Dated and newest first, as company news is (round 20).
    const news: NewsEntry[] = personNews(newsResults, personName);
    // The organization's top stories (Gecko's Navy contract), same filters.
    const companyNews: NewsEntry[] = org ? personNews(companyNewsResults, org).slice(0, 3) : [];
    for (const n of companyNews) if (n.url) sources.push(sourceOf(n.url, n.headline, "company-news"));

    // A role a source says ended isn't current (fix 6).
    const ended = clearEndedRole(person, careerHistory);
    if (ended) console.log(`[people-agent] "${personName}": ${ended}`);
    // Bio pages carry no dates: a dated appointment or departure from the
    // last two years is the newest word on the current role.
    const changed = applyRoleChange({ person, careerHistory }, roleFromNews(news, personName));
    if (changed) console.log(`[people-agent] "${personName}": ${changed}`);

    return {
      person, careerHistory, news, sources,
      ...(boardSeats.length ? { boardSeats } : {}),
      ...(companyNews.length ? { companyNews } : {}),
    };
  }
}
