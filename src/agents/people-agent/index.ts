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
import { isNewsNoise, isUsableHeadline, mentionsPerson } from "../../lib/news-noise.js";
import { mentionsAffiliation } from "../../lib/entities/affiliation.js";
import { applyRoleChange, personNews, roleFromNews, summaryFromSnippet } from "../../lib/person-checks.js";
import {
  bioExcerpt, clearEndedRole, confirmBoardSeats, isBoardPage, isProfilePage, officialBioPages, secPersonExcerpts,
  sourceOf, surnameOf, tiedToOrg, type SecExcerpt, type TiedText,
  anchorCurrentRole, boardsNamed, educationFor, isHomepage, recentEnough, seatsFromBoardPages, settleTitles, statedSeatDates, within,
} from "../../lib/person-sources.js";
import { hostOf, newsAboutSubject } from "../../lib/entities/subject.js";
import { isRoleTitle, namesOrg } from "../../lib/person-checks.js";
import { stockListingFor } from "../website-agent/index.js";
import { Form4Agent } from "../form4-agent/index.js";
import { samePerson } from "../../lib/leadership.js";

// Placeholder employers the extractor sometimes fills in ("Actor at
// Various") instead of leaving the field out.
const PLACEHOLDER_ORG = /^(various|various companies|multiple|several|n\/a|na|unknown|none|not specified|unspecified)$/i;

const namesOrgEither = (a: string, b: string) => namesOrg(a, b) || namesOrg(b, a);

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
    // Under the coverage recorder's 90s with room to spare (Oct 28 handoff:
    // McCann's whole report was lost when this agent ran past 90s). Each
    // step after the searches gets what's left; an optional one that runs
    // out is skipped, never the report.
    const startedAt = Date.now();
    const left = () => 75_000 - (Date.now() - startedAt);
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
    // organization's news (Oct 27 handoff, fixes 2-5 and 8). A job title
    // ("Board Member") is never that organization (Oct 28 handoff).
    const typed = affiliation?.replace(/[.,;:]+$/, "").trim();
    const org = typed && !isRoleTitle(typed) ? typed : undefined;
    const none = Promise.resolve([]);
    const [bioResultsRaw, newsResultsRaw, backgroundResultsRaw, profileResultsRaw, execBioResultsRaw, boardResultsRaw, secExcerpts] = await Promise.all([
      this.searcher.search(appendDomainExclusions(`${searchSubject} current role position ${currentYear}`, override), resultCount),
      // Twice the results needed: social, forum and tag-index pages are dropped below.
      this.searcher.search(appendDomainExclusions(`${searchSubject} news ${currentYear}`, override), resultCount * 2),
      this.searcher.search(appendDomainExclusions(`${searchSubject} education background biography`, override), bgResultCount),
      org ? this.searcher.search(appendDomainExclusions(`"${personName}" ${org}`, override), 10) : none,
      org ? this.searcher.search(`${personName} ${org} leadership bio`, resultCount) : none,
      // With the organization: the bare name fanned out across namesakes' boards.
      // Other boards' own pages name the employer in the bio, not always in the snippet the org query needs.
      org ? Promise.all([
        this.searcher.search(appendDomainExclusions(`"${personName}" ${org} board of directors`, override), resultCount * 2),
        this.searcher.search(appendDomainExclusions(`"${personName}" "board of directors"`, override), resultCount),
      ]).then(([a, b]) => [...a, ...b.filter((r) => !a.some((x) => x.url === r.url))]) : none,
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
      .filter((r) => !isRejectedDomain(r.url, override) && !isNewsNoise(r.url) && !isProfilePage(r.url) && !isHomepage(r.url))
      .filter((r) => isUsableHeadline(r.title) && aboutThisPerson(r))
      .slice(0, resultCount);
    const backgroundResults = backgroundResultsRaw.filter((r) => !isRejectedDomain(r.url, override) && aboutThisPerson(r));
    // The picker's snippets carry facts (McCann's Drexel MBA) the other
    // searches can miss: they go to extraction too (fix 5).
    const known = new Set([...bioResults, ...backgroundResults].map((r) => r.url));
    const profileResults = profileResultsRaw.filter((r) => !known.has(r.url) && !isRejectedDomain(r.url, override) && aboutThisPerson(r));
    // The top two pages on the organization's own site; the first whose
    // text names the person is the official bio (Gecko's about page).
    const bioPageCandidates = org ? officialBioPages([...execBioResultsRaw, ...bioResultsRaw, ...profileResultsRaw], personName, org).slice(0, 2) : [];
    const boardCandidates = boardResultsRaw
      .filter((r) => !isRejectedDomain(r.url, override) && !bioPageCandidates.some((b) => b.url === r.url) && isBoardPage(r, personName))
      .slice(0, deep ? 4 : 3);

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
    const noPage = <T,>(list: T[]) => list.map(() => null);
    const [fetchedBios, bioPageTexts, boardTexts] = await Promise.all([
      within(Promise.all(bioResults.slice(0, fullTextSourceCount).map(r => fetchPageText(r.url, this.fetcher, fullTextChars))), 15_000, noPage(bioResults.slice(0, fullTextSourceCount)), "bio pages"),
      within(Promise.all(bioPageCandidates.map((r) => pageText(r.url))), 15_000, noPage(bioPageCandidates), "official bio"),
      within(Promise.all(boardCandidates.map((r) => pageText(r.url))), 15_000, noPage(boardCandidates), "board pages"),
    ]);
    const last = surnameOf(personName);
    const bioIndex = bioPageTexts.findIndex((t) => !!t && new RegExp(`\\b${last}\\b`, "i").test(t));
    const officialBio = bioIndex >= 0 ? bioPageCandidates[bioIndex] : undefined;
    const officialExcerpt = officialBio ? bioExcerpt(bioPageTexts[bioIndex]!, personName, 4000) : undefined;
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
      `BACKGROUND:\n${backgroundText}`,
    ].filter(Boolean).join("\n\n").slice(0, 18_000) || snippetText;

    // Pages and snippets that name this person and the picked organization:
    // what may vouch for a board seat or a school.
    const tiedSources: TiedText[] = org ? [
      ...fetchedBios.flatMap((t, i) => (t && tiedToOrg(t, personName, org) ? [{ url: bioResults[i].url, text: t }] : [])),
      ...[...bioResults, ...backgroundResults, ...profileResults].flatMap((r) => {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        return tiedToOrg(text, personName, org) ? [{ url: r.url, text }] : [];
      }),
    ] : [];

    let usedLLM = false;
    if (combinedText.length > 0) {
      // What's left after the searches, less time for the steps after it.
      const llmResult = await within(extractStructured(
        `You are a research assistant extracting biographical facts about "${personName}"${affiliation ? ` (search context: "${affiliation}", which may be an employer, school or location — use it to make sure you're extracting facts about the right person, not a same-named stranger)` : ""} from search results. Today's year is ${currentYear}.

Extract these fields:
- summary: 2-3 sentences describing who this person is, what they're known for, and why they matter. Write it like the opening of a Wikipedia article — specific, confident, factual. No filler.
- currentRole: their main operating job as of ${currentYear} (an executive or staff role). A board seat or non-executive chair at another organization is never the currentRole; it goes in boardSeats.${org ? ` When they hold a role at ${org}, that role is the currentRole.` : ""}
- currentCompany: the organization they currently work for
- education: every degree stated, with school and year when given, separated by semicolons (e.g. "B.S. in Mechanical Engineering, Worcester Polytechnic Institute; MBA, Drexel University"). Word each degree exactly as the text does; never turn it into an abbreviation or another degree name. Check the OFFICIAL BIO and BOARD PAGE text for it first.
- founding: one sentence on the company they founded, when the text states it: the year, every co-founder named and any accelerator or program (e.g. "Y Combinator, Winter 2016")
- knownFor: one sentence on what they're most notable for (invention, company, achievement, controversy)
- nationality: their nationality or country of origin if mentioned
- careerHistory: array of {title, company, start, end, current} in reverse chronological order (most recent first), every role the text mentions, past ones included. start and end: the month and year when the text states them ("Mar 2023"), else the year; omit a date the text doesn't give. current: false when the text says the role ended or calls it former or previous; true only when the text says they hold it now. A board seat at their own employer (e.g. Chairman) is a careerHistory entry.
- boardSeats: array of {organization, role, start, end} for other organizations' boards (companies, associations, nonprofits) the text says this person sits or sat on. Never include their own employer here.
- announcedDeparture: one sentence, with the date, when the text says they announced they will leave or retire from a role they still hold.

RULES:
- currentRole must reflect their position as of ${currentYear}. If a source says "former", do NOT list it as current.
- Never expand an acronym or abbreviation unless the text spells it out; otherwise keep it exactly as written. Never guess what letters stand for.
- An OFFICIAL BIO is the person's employer's own page and an SEC filing is sworn: prefer them for titles, dates, prior roles, education and directorships.
- Take titles and roles only from what the text says about this person. Never infer them from a URL, domain, site name or page section (a profile hosted on a research office's site doesn't make someone that office's head).
- If you cannot confidently determine a field, omit it rather than guessing.
- Be specific — name actual companies, schools, dollar figures where available.
- Never include home or street addresses, phone numbers, personal email addresses or other contact details in any field, even if a source lists them. A city or region is fine only when it's part of who they are publicly (e.g. "Austin-based founder").
- Every careerHistory entry and currentCompany must name one real organization. Never use placeholders like "Various", "Multiple" or "N/A"; leave the entry out instead.
- Don't name a company someone merely worked with as their employer. A freelance actor, athlete or artist appearing in a studio's or brand's projects isn't employed by it; for them, omit currentCompany unless they actually hold a role there (owner, executive, signed team, etc.).`,
        combinedText,
        PersonExtractionSchema
      ), left() - 15_000, null, "extraction");

      if (llmResult) {
        usedLLM = true;
        if (llmResult.summary)        person.summary        = llmResult.summary;
        if (llmResult.currentRole)    person.currentRole    = llmResult.currentRole;
        if (llmResult.currentCompany && !isPlaceholderOrg(llmResult.currentCompany)) person.currentCompany = llmResult.currentCompany;
        if (llmResult.education)      person.education      = llmResult.education;
        // No net worth: the figures are celebrity-site guesses with no
        // citable basis (Oct 28: McCann's "$9 M $", McGowan's "$150M–$500M").
        if (llmResult.knownFor)       person.knownFor       = llmResult.knownFor;
        if (llmResult.nationality)    person.nationality    = llmResult.nationality;
        if (llmResult.announcedDeparture) person.announcedDeparture = llmResult.announcedDeparture;
        if (llmResult.founding) person.founding = llmResult.founding;
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
        const vouched: TiedText[] = [
          ...(officialExcerpt && officialBio ? [{ url: officialBio.url, text: officialExcerpt }] : []),
          ...secExcerpts.map((e) => ({ url: e.url, text: e.text })),
        ];
        boardSeats = confirmBoardSeats(
          [
            ...llmResult.boardSeats.filter((b) => !isPlaceholderOrg(b.organization)),
            // As the texts say them, whatever the model listed (Oct 29).
            ...boardsNamed([...vouched, ...boardPages, ...tiedSources].map((t) => t.text), personName),
            ...seatsFromBoardPages(boardPages.map((b) => ({ url: b.url, title: boardCandidates.find((r) => r.url === b.url)!.title })), personName),
          ],
          { boardPages, vouched, tied: tiedSources },
          [org, person.currentCompany].filter((e): e is string => !!e),
        );
        // Each seat's dates as a source states them for that seat (Oct 29 holdout).
        boardSeats = statedSeatDates(boardSeats, [...vouched, ...boardPages, ...tiedSources].map((t) => t.text), personName);
      }
    }

    if (!usedLLM || (!person.currentRole && careerHistory.length === 0)) {
      const seenRoles = new Set<string>();
      for (const r of bioResults) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        const sentences = splitSentences(text);

        for (const sentence of sentences) {
          const match = extractRoleAndCompany(sentence);
          // "President and CEO - Limbach" read as "CEO" at "President and".
          if (!match || isRoleTitle(match.company) || /(^|\s)(and|&)$/i.test(match.company.trim())) continue;

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

    // Every text that names this person and the picked organization: the
    // only place education may come from (Oct 28 handoff: a namesake's
    // "Edwards School" in Loosararian's report).
    const snippetsOf = (rs: { title: string; snippet?: string }[]) => rs.map((r) => `${r.title}. ${r.snippet ?? ""}`);
    const allSnippets = snippetsOf([...bioResults, ...backgroundResults, ...profileResults]);
    // Education from text naming the person and the picked organization, or
    // an employer that text names too (Boyle's Jesuit bio names his schools,
    // not always Homeboy); the organization's own word first (Oct 29: a
    // namesake's degree on Darway). The model's degrees as those texts word
    // them, plus the degrees read straight from them.
    const withUrls = (rs: { url: string; title: string; snippet?: string }[]) => rs.map((r) => ({ url: r.url, text: `${r.title}. ${r.snippet ?? ""}` }));
    const eduSources = [
      ...(officialExcerpt && officialBio ? [{ url: officialBio.url, text: officialExcerpt, vouched: true }] : []),
      ...boardPages.map((b) => ({ ...b, vouched: true })),
      ...secExcerpts.map((e) => ({ url: e.url, text: e.text, vouched: true })),
      ...fetchedBios.flatMap((t, i) => (t ? [{ url: bioResults[i].url, text: t }] : [])),
      ...withUrls([...bioResults, ...backgroundResults, ...profileResults]),
    ];
    const employers = [person.currentCompany, ...careerHistory.map((c) => c.company)].filter((a): a is string => !!a && !isPlaceholderOrg(a));
    const before = person.education;
    person.education = educationFor(before, eduSources, personName, org, employers);
    if (person.education !== before) console.log(`[people-agent] "${personName}": education "${before ?? "none"}" -> "${person.education ?? "none"}"`);
    if (!person.education) delete person.education;

    // Dated and newest first, as company news is (round 20). An undated
    // item (speaker pages) can't be placed in time: dropped.
    // Older than two years isn't recent news (Oct 28: Dec 2011 for Mazzarella).
    const news: NewsEntry[] = personNews(newsResults, personName).filter((n) => recentEnough(n.date));
    // The employer's top stories (Gecko's Navy contract), same filters, and
    // the person's own Form 4 filings when it's listed. The employer is the
    // picked organization, else the extracted one: never a job title.
    // A role a source says ended isn't current (fix 6).
    const ended = clearEndedRole(person, careerHistory);
    if (ended) console.log(`[people-agent] "${personName}": ${ended}`);
    // Bio pages carry no dates: a dated appointment or departure from the
    // last two years is the newest word on the current role.
    const changed = applyRoleChange({ person, careerHistory }, roleFromNews(news, personName));
    if (changed) console.log(`[people-agent] "${personName}": ${changed}`);
    // The picked organization sets the current role, unless a dated story
    // says they left it.
    if (org && !changed?.startsWith("left")) {
      const anchored = anchorCurrentRole(person, careerHistory, org);
      if (anchored) console.log(`[people-agent] "${personName}": ${anchored}`);
    }

    // A CEO title dropped only where someone else is named the current CEO
    // (Boyle and Homeboy's Thomas Vozzo, never Gellert and his predecessor),
    // the fullest title the sources give, the current role first (Oct 28).
    const settled = settleTitles(person, careerHistory, [org, person.currentCompany].filter((x): x is string => !!x), {
      snippets: [...allSnippets, ...snippetsOf(newsResultsRaw), ...(officialExcerpt ? [officialExcerpt] : [])],
      summary: person.summary,
      // Every text the model read, for the dates it gave.
      dated: [
        ...(officialExcerpt ? [officialExcerpt] : []), ...secExcerpts.map((e) => e.text), ...boardPages.map((b) => b.text),
        ...fetchedBios.filter((t): t is string => !!t), ...allSnippets, ...snippetsOf(newsResultsRaw),
      ],
    });
    careerHistory = settled.careerHistory;
    const officerConflicts = settled.officerConflicts;
    for (const n of settled.notes) console.log(`[people-agent] "${personName}": ${n}`);


    // The employer's top stories (Gecko's Navy contract) and the person's
    // own Form 4 filings when it's listed, in parallel with what time is
    // left. The employer is the picked organization, else the extracted
    // one: never a job title. Its news passes the same entity and namesake
    // checks as company Recent News (Oct 28 handoff: Patagonia the region).
    const employer = org ?? (person.currentCompany && !isRoleTitle(person.currentCompany) ? person.currentCompany : undefined);
    // The heading names the company as its own sources do ("Graybar Electric Company").
    const employerName = (employer && person.currentCompany && namesOrgEither(person.currentCompany, employer) ? person.currentCompany : employer)?.replace(/[.,;:]+$/, "");
    const seenNews = new Set(newsResults.map((r) => r.url));
    const subject = employer ? { name: employer, anchor: {}, domain: officialBio ? hostOf(officialBio.url) : undefined } : undefined;
    const companyNewsRaw = subject
      ? await within(this.searcher.search(`"${employer}" news ${currentYear}`, resultCount * 2), Math.min(left(), 12_000), [], "company news")
      : [];
    const companyNews: NewsEntry[] = subject
      ? personNews(companyNewsRaw
        .filter((r) => !seenNews.has(r.url) && !isNewsNoise(r.url) && !isProfilePage(r.url) && !isHomepage(r.url))
        .filter((r) => isUsableHeadline(r.title) && newsAboutSubject(`${r.title}. ${r.snippet ?? ""}`, r.url, subject)), employer!)
        .filter((n) => recentEnough(n.date)).slice(0, 3)
      : [];
    for (const n of companyNews) if (n.url) sources.push(sourceOf(n.url, n.headline, "company-news"));
    const insiderTrades = employer
      ? await within(this.insiderTrades(personName, employer, [...companyNewsRaw, ...bioResultsRaw, ...newsResultsRaw, ...profileResultsRaw], sources), Math.min(left(), 15_000), [], "insider trades")
      : [];

    return {
      person, careerHistory, news, sources,
      ...(boardSeats.length ? { boardSeats } : {}),
      ...(companyNews.length ? { companyNews, companyNewsOrg: employerName } : {}),
      ...(insiderTrades.length ? { insiderTrades } : {}),
      ...(officerConflicts.length ? { officerConflicts } : {}),
    };
  }

  /**
   * The person's own Form 4 filings (Oct 28 handoff): the employer's ticker
   * from a search result that names it ("Limbach Holdings, Inc. (NASDAQ:
   * LMB)"), then OpenInsider's table for that ticker, kept to rows filed by
   * this person.
   */
  private async insiderTrades(personName: string, employer: string, results: { title: string; snippet?: string }[], sources: Source[]) {
    const listing = results.map((r) => stockListingFor(`${r.title}. ${r.snippet ?? ""}`, [employer])).find(Boolean);
    const ticker = listing?.split(/:\s*/)[1];
    if (!ticker) return [];
    const form4 = new Form4Agent(this.searcher, this.fetcher);
    const rows = (await form4.openInsider(ticker).catch(() => null)) ?? [];
    const mine = rows.filter((f) => samePerson(f.filerName, personName));
    if (mine.length) sources.push(sourceOf(`https://openinsider.com/screener?s=${encodeURIComponent(ticker)}`, `OpenInsider — ${ticker} insider filings`, "insider-activity"));
    console.log(`[people-agent] "${personName}": ${listing}, ${mine.length} of ${rows.length} Form 4 row(s) filed by them`);
    return mine;
  }
}
