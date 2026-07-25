import { WebsiteAgent } from "../website-agent/index.js";
import { NewsAgent } from "../news-agent/index.js";
import { CompetitorAgent } from "../competitor-agent/index.js";
import { CorporateAgent } from "../corporate-agent/index.js";
import { PeopleAgent } from "../people-agent/index.js";
import { ProductAgent } from "../product-agent/index.js";
import { PoliticalAgent } from "../political-agent/index.js";
import { CreatorSignalAgent } from "../creator-signal-agent/index.js";
import { CongressAgent } from "../congress-agent/index.js";
import { LegiScanAgent } from "../legiscan-agent/index.js";
import { OpenFecAgent } from "../openfec-agent/index.js";
import { OpenCorporatesAgent } from "../opencorporates-agent/index.js";
import { MuckRockAgent } from "../muckrock-agent/index.js";
import { USASpendingAgent } from "../usaspending-agent/index.js";
import { SanctionsAgent } from "../sanctions-agent/index.js";
import { WaybackAgent } from "../wayback-agent/index.js";
import { ProPublicaNonprofitAgent } from "../propublica-nonprofit-agent/index.js";
import { LittleSisAgent } from "../littlesis-agent/index.js";
import { IcijAgent } from "../icij-agent/index.js";
import { synthesizeRisksOpportunities } from "../synthesis-agent/index.js";
import { ReportAgent } from "../report-agent/index.js";
import {
  DirectFetchProvider,
  SerperSearchProvider,
  SearchProvider,
} from "../../lib/providers.js";
import {
  CreatorResearchBundle,
  PersonResearchBundle,
  PoliticalResearchBundle,
  ProductResearchBundle,
  ResearchBundle,
  Source,
  WebArchiveSummary,
} from "../../types/research.js";
import { classifyOfficeType } from "../../lib/office-classifier.js";
import { lookupStatewideExecutive } from "../../database/statewide-executives.js";

/**
 * Research Orchestrator
 * Receives a request, launches agent tasks, aggregates findings, hands
 * the bundle to the Report Agent.
 *
 * Agents run in parallel via Promise.all — each agent already does its
 * own internal error handling (providers return [] / null on failure
 * rather than throwing), so one agent being slow or empty doesn't block
 * or break the others. The only shared resource is the Serper rate
 * limit; four agents firing at once is well within free-tier limits for
 * a single research run.
 */
export class ResearchOrchestrator {
  private websiteAgent: WebsiteAgent;
  private newsAgent: NewsAgent;
  private competitorAgent: CompetitorAgent;
  private corporateAgent: CorporateAgent;
  private peopleAgent: PeopleAgent;
  private productAgent: ProductAgent;
  private politicalAgent: PoliticalAgent;
  private creatorSignalAgent: CreatorSignalAgent;
  private congressAgent: CongressAgent;
  private legiScanAgent: LegiScanAgent;
  private openFecAgent: OpenFecAgent;
  private openCorporatesAgent: OpenCorporatesAgent;
  private muckRockAgent: MuckRockAgent;
  private usaSpendingAgent: USASpendingAgent;
  private sanctionsAgent: SanctionsAgent;
  private waybackAgent: WaybackAgent;
  private nonprofitAgent: ProPublicaNonprofitAgent;
  private littleSisAgent: LittleSisAgent;
  private icijAgent: IcijAgent;
  private reportAgent: ReportAgent;
  private searcher: SearchProvider;

  constructor() {
    const fetcher = new DirectFetchProvider();
    const searcher = new SerperSearchProvider();
    this.searcher = searcher;
    this.websiteAgent = new WebsiteAgent(fetcher, searcher);
    this.newsAgent = new NewsAgent(fetcher, searcher);
    this.competitorAgent = new CompetitorAgent(fetcher, searcher);
    this.corporateAgent = new CorporateAgent(fetcher, searcher);
    this.peopleAgent = new PeopleAgent(fetcher, searcher);
    this.productAgent = new ProductAgent(fetcher, searcher);
    this.politicalAgent = new PoliticalAgent(fetcher, searcher);
    this.creatorSignalAgent = new CreatorSignalAgent(fetcher, searcher);
    this.congressAgent = new CongressAgent(searcher);
    this.legiScanAgent = new LegiScanAgent();
    this.openFecAgent = new OpenFecAgent();
    this.openCorporatesAgent = new OpenCorporatesAgent(searcher, fetcher);
    this.muckRockAgent = new MuckRockAgent();
    this.usaSpendingAgent = new USASpendingAgent();
    this.sanctionsAgent = new SanctionsAgent();
    this.waybackAgent = new WaybackAgent();
    this.nonprofitAgent = new ProPublicaNonprofitAgent();
    this.littleSisAgent = new LittleSisAgent();
    this.icijAgent = new IcijAgent();
    this.reportAgent = new ReportAgent();
  }

  /**
   * @param proAccess 7/20 public-record fusion sources (sanctions
   *   screening, Wayback archive history, ProPublica nonprofit lookup,
   *   LittleSis power-mapping) — gated to Pro/Team/internal via
   *   TierConfig.publicRecordsAccess, checked by the caller.
   * @param deep Charon Protocol (internal tier only) — adds the ICIJ
   *   Offshore Leaks reconciliation lookup on top of proAccess sources.
   */
  async researchCompany(companyName: string, proAccess = false, deep = false): Promise<{
    bundle: ResearchBundle;
    report: string;
  }> {
    const [siteResult, newsResult, competitorResult, corporateResult, spendingResult] =
      await Promise.all([
        this.websiteAgent.run(companyName),
        this.newsAgent.run(companyName),
        this.competitorAgent.run(companyName),
        this.corporateAgent.run(companyName),
        // Free public API, no tier gating — every research run gets this.
        this.usaSpendingAgent.run(companyName),
      ]);

    // Public-record fusion sources — Pro/Team+ only. Wayback needs a
    // resolved website URL, which only exists once siteResult is in, so
    // this batch runs after the first Promise.all rather than alongside it.
    const [sanctionsResult, waybackResult, nonprofitResult, littleSisResult, icijResult] =
      await Promise.all([
        proAccess ? this.sanctionsAgent.run(companyName) : Promise.resolve({ matches: [], sources: [] }),
        proAccess && siteResult.company.website ? this.waybackAgent.run(siteResult.company.website) : Promise.resolve({ summary: {} as WebArchiveSummary, sources: [] }),
        proAccess ? this.nonprofitAgent.run(companyName) : Promise.resolve({ organizations: [], sources: [] }),
        proAccess ? this.littleSisAgent.run(companyName) : Promise.resolve({ matches: [], sources: [] }),
        deep ? this.icijAgent.run(companyName) : Promise.resolve({ matches: [], sources: [] }),
      ]);

    const sources: Source[] = [
      ...siteResult.sources,
      ...newsResult.sources,
      ...competitorResult.sources,
      ...corporateResult.sources,
      ...spendingResult.sources,
      ...sanctionsResult.sources,
      ...waybackResult.sources,
      ...nonprofitResult.sources,
      ...littleSisResult.sources,
      ...icijResult.sources,
    ];

    const bundle: ResearchBundle = {
      query: companyName,
      generatedAt: new Date().toISOString(),
      company: siteResult.company,
      leadership: siteResult.leadership,
      products: siteResult.products,
      news: newsResult.news,
      funding: corporateResult.funding,
      competitors: competitorResult.competitors,
      ownership: corporateResult.ownership,
      sources,
      federalSpending: spendingResult.awards,
      insiderActivity: corporateResult.insiderActivity,
      sanctionsMatches: sanctionsResult.matches.length > 0 ? sanctionsResult.matches : undefined,
      webArchive: waybackResult.summary.snapshotCount ? waybackResult.summary : undefined,
      nonprofitFilings: nonprofitResult.organizations.length > 0 ? nonprofitResult.organizations : undefined,
      powerMapConnections: littleSisResult.matches.length > 0 ? littleSisResult.matches : undefined,
      offshoreLeaksMatches: icijResult.matches.length > 0 ? icijResult.matches : undefined,
    };

    // Risks/Opportunities is pure LLM synthesis with no heuristic
    // fallback — see synthesis-agent for why. Runs after the rest of
    // the bundle is assembled since it needs the full picture as input.
    const synthesis = await synthesizeRisksOpportunities(bundle);
    if (synthesis) {
      bundle.risks = synthesis.risks;
      bundle.opportunities = synthesis.opportunities;
    }

    const report = this.reportAgent.generate(bundle);

    return { bundle, report };
  }

  /**
   * @param deep Charon Protocol (internal tier only, no daily/monthly
   *   limits — see server/agent-server.ts). Deeper sourcing, same shape,
   *   plus Charon Person Research (Round 3): OpenCorporates
   *   officer/directorship records across every jurisdiction it indexes.
   *   Skipped entirely on non-Charon runs — this is a broad "search
   *   everywhere for this exact name" lookup that fits Charon's
   *   no-limits role, not a default-tier feature.
   * @param affiliation Optional school/employer/org, already split out of
   *   the raw query by the caller (parsePersonQuery in src/lib/nlp.ts) —
   *   e.g. "csun" from "Daniel Olmos csun". `personName` here is always
   *   the clean name; OpenCorporates/MuckRock search by legal name only,
   *   so affiliation is passed to the people agent alone.
   * @param proAccess 7/20 public-record fusion sources (sanctions
   *   screening, ProPublica nonprofit lookup, LittleSis power-mapping) —
   *   gated to Pro/Team/internal via TierConfig.publicRecordsAccess,
   *   checked by the caller. No Wayback for person research — see
   *   wayback-agent's doc comment for why.
   */
  async researchPerson(personName: string, deep = false, affiliation?: string, proAccess = false): Promise<{
    bundle: PersonResearchBundle;
    report: string;
  }> {
    const [result, corporateResult, foiaResult, sanctionsResult, nonprofitResult, littleSisResult, icijResult] = await Promise.all([
      this.peopleAgent.run(personName, deep, affiliation),
      deep ? this.openCorporatesAgent.run(personName) : Promise.resolve({ affiliations: [], sources: [] }),
      deep ? this.muckRockAgent.run(personName) : Promise.resolve({ requests: [], sources: [] }),
      proAccess ? this.sanctionsAgent.run(personName) : Promise.resolve({ matches: [], sources: [] }),
      proAccess ? this.nonprofitAgent.run(personName) : Promise.resolve({ organizations: [], sources: [] }),
      proAccess ? this.littleSisAgent.run(personName) : Promise.resolve({ matches: [], sources: [] }),
      deep ? this.icijAgent.run(personName) : Promise.resolve({ matches: [], sources: [] }),
    ]);

    const bundle: PersonResearchBundle = {
      query: personName,
      generatedAt: new Date().toISOString(),
      person: result.person,
      careerHistory: result.careerHistory,
      news: result.news,
      sources: [
        ...result.sources, ...corporateResult.sources, ...foiaResult.sources,
        ...sanctionsResult.sources, ...nonprofitResult.sources, ...littleSisResult.sources, ...icijResult.sources,
      ],
      corporateAffiliations: corporateResult.affiliations.length > 0 ? corporateResult.affiliations : undefined,
      foiaRequests: foiaResult.requests.length > 0 ? foiaResult.requests : undefined,
      sanctionsMatches: sanctionsResult.matches.length > 0 ? sanctionsResult.matches : undefined,
      nonprofitFilings: nonprofitResult.organizations.length > 0 ? nonprofitResult.organizations : undefined,
      powerMapConnections: littleSisResult.matches.length > 0 ? littleSisResult.matches : undefined,
      offshoreLeaksMatches: icijResult.matches.length > 0 ? icijResult.matches : undefined,
    };

    const report = this.reportAgent.generatePerson(bundle);

    return { bundle, report };
  }

  async researchProduct(productName: string): Promise<{
    bundle: ProductResearchBundle;
    report: string;
  }> {
    const bundle = await this.productAgent.run(productName);
    const report = this.reportAgent.generateProduct(bundle);
    return { bundle, report };
  }

  /**
   * Creator / market-signal research (general v1, per
   * docs/next-verticals-scoping.md item #1): who is this creator/account,
   * is their reach rising or falling, and what are people currently
   * saying about them. Reuses NewsAgent directly for press coverage —
   * same parallel-dispatch pattern researchCompany uses for its own news
   * call — rather than duplicating that logic inside the signal agent.
   */
  async researchCreator(name: string): Promise<{
    bundle: CreatorResearchBundle;
    report: string;
  }> {
    const [signalResult, newsResult] = await Promise.all([
      this.creatorSignalAgent.run(name),
      this.newsAgent.run(name),
    ]);

    const bundle: CreatorResearchBundle = {
      query: name,
      generatedAt: new Date().toISOString(),
      profile: signalResult.profile,
      youtubeStats: signalResult.youtubeStats,
      trend: signalResult.trend,
      signals: signalResult.signals,
      shortFormMentions: signalResult.shortFormMentions,
      news: newsResult.news,
      sources: [...signalResult.sources, ...newsResult.sources],
    };

    const report = this.reportAgent.generateCreator(bundle);

    return { bundle, report };
  }

  /**
   * Political research (Round 2, item 1): opposition research, district
   * makeup, approval ratings, voting record, campaign finance.
   * @param deep Charon Protocol (internal tier only) — deeper sourcing,
   *   including full-page reads for the top opposition-research sources.
   *
   * Round 2 v2: runs the search-synthesis political-agent alongside real
   * API integrations (Congress.gov, LegiScan, OpenFEC, statewide-
   * executives table). Authoritative API/table data overrides the
   * LLM-guessed profile fields (office/party/state/district) where
   * available; LegiScan needs a state to resolve a legislative session,
   * so it runs after the others have had a chance to supply one.
   *
   * Political research fix #1: classifies office type first (federal /
   * state-legislator / statewide-executive / local / unknown) and uses
   * it to route dispatch — Congress.gov and OpenFEC are federal-only, so
   * there's no reason to call either for a governor or state senator.
   * "unknown" always falls back to trying every source, identical to the
   * pre-classifier behavior — this only narrows dispatch, never blocks a
   * legitimate source.
   */
  async researchPolitical(name: string, deep = false): Promise<{
    bundle: PoliticalResearchBundle;
    report: string;
  }> {
    const officeType = await classifyOfficeType(name, this.searcher);
    const runFederalSources = officeType === "federal" || officeType === "unknown";
    const runStatewideLookup = officeType === "statewide-executive" || officeType === "unknown";
    const skipLegiscan = officeType === "local";

    const [searchResult, congressResult, fecResult, foiaResult, statewideResult] = await Promise.all([
      this.politicalAgent.run(name, deep),
      runFederalSources ? this.congressAgent.run(name) : Promise.resolve({ sponsoredLegislation: [], sources: [] }),
      runFederalSources ? this.openFecAgent.run(name) : Promise.resolve({ donorBreakdown: [], sources: [] }),
      deep ? this.muckRockAgent.run(name) : Promise.resolve({ requests: [], sources: [] }),
      runStatewideLookup ? lookupStatewideExecutive(name) : Promise.resolve({ found: false }),
    ]);

    const state = congressResult.state ?? statewideResult.state ?? searchResult.profile.state;
    const legiscanResult = skipLegiscan
      ? { sponsoredLegislation: [], sources: [] }
      : await this.legiScanAgent.run(name, state);

    const sources: Source[] = [
      ...searchResult.sources,
      ...congressResult.sources,
      ...fecResult.sources,
      ...legiscanResult.sources,
      ...foiaResult.sources,
    ];
    if (statewideResult.found && statewideResult.sourceUrl) {
      sources.push({
        url: statewideResult.sourceUrl,
        title: `Statewide executive record — ${name}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["profile"],
      });
    }

    const office = congressResult.office ?? statewideResult.office ?? searchResult.profile.office;
    const party = congressResult.party ?? legiscanResult.party ?? statewideResult.party ?? searchResult.profile.party;
    const resolvedState = state ?? searchResult.profile.state;
    const district = congressResult.district ?? legiscanResult.district ?? searchResult.profile.district;

    // Political research fix #3: an explicit "we don't have this" flag
    // instead of a silent blank or LLM-guessed-only profile, once every
    // authoritative source has had a chance to weigh in and still came
    // up empty. Skipped on a name mismatch — that's a different, more
    // specific warning already.
    const dataUnavailable =
      !searchResult.profile.nameMismatchWarning &&
      !office && !party && !resolvedState &&
      congressResult.sponsoredLegislation.length === 0 &&
      legiscanResult.sponsoredLegislation.length === 0 &&
      !fecResult.summary &&
      !statewideResult.found;

    const bundle: PoliticalResearchBundle = {
      query: name,
      generatedAt: new Date().toISOString(),
      profile: {
        ...searchResult.profile,
        office,
        party,
        state: resolvedState,
        district,
        officeType,
        dataUnavailable: dataUnavailable || undefined,
      },
      districtMakeup: searchResult.districtMakeup,
      approvalRating: searchResult.approvalRating,
      votingRecord: searchResult.votingRecord,
      campaignFinance: searchResult.campaignFinance,
      oppositionResearch: searchResult.oppositionResearch,
      news: searchResult.news,
      sources,
      sponsoredLegislation: [...congressResult.sponsoredLegislation, ...legiscanResult.sponsoredLegislation],
      fecSummary: fecResult.summary,
      fecDonorBreakdown: fecResult.donorBreakdown,
      foiaRequests: foiaResult.requests.length > 0 ? foiaResult.requests : undefined,
    };

    const report = this.reportAgent.generatePolitical(bundle);

    return { bundle, report };
  }
}
