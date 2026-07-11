import { WebsiteAgent } from "../website-agent/index.js";
import { NewsAgent } from "../news-agent/index.js";
import { CompetitorAgent } from "../competitor-agent/index.js";
import { CorporateAgent } from "../corporate-agent/index.js";
import { PeopleAgent } from "../people-agent/index.js";
import { ProductAgent } from "../product-agent/index.js";
import { PoliticalAgent } from "../political-agent/index.js";
import { CongressAgent } from "../congress-agent/index.js";
import { LegiScanAgent } from "../legiscan-agent/index.js";
import { OpenFecAgent } from "../openfec-agent/index.js";
import { OpenCorporatesAgent } from "../opencorporates-agent/index.js";
import { MuckRockAgent } from "../muckrock-agent/index.js";
import { USASpendingAgent } from "../usaspending-agent/index.js";
import { synthesizeRisksOpportunities } from "../synthesis-agent/index.js";
import { ReportAgent } from "../report-agent/index.js";
import {
  DirectFetchProvider,
  SerperSearchProvider,
} from "../../lib/providers.js";
import {
  PersonResearchBundle,
  PoliticalResearchBundle,
  ProductResearchBundle,
  ResearchBundle,
  Source,
} from "../../types/research.js";

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
  private congressAgent: CongressAgent;
  private legiScanAgent: LegiScanAgent;
  private openFecAgent: OpenFecAgent;
  private openCorporatesAgent: OpenCorporatesAgent;
  private muckRockAgent: MuckRockAgent;
  private usaSpendingAgent: USASpendingAgent;
  private reportAgent: ReportAgent;

  constructor() {
    const fetcher = new DirectFetchProvider();
    const searcher = new SerperSearchProvider();
    this.websiteAgent = new WebsiteAgent(fetcher, searcher);
    this.newsAgent = new NewsAgent(fetcher, searcher);
    this.competitorAgent = new CompetitorAgent(fetcher, searcher);
    this.corporateAgent = new CorporateAgent(fetcher, searcher);
    this.peopleAgent = new PeopleAgent(fetcher, searcher);
    this.productAgent = new ProductAgent(fetcher, searcher);
    this.politicalAgent = new PoliticalAgent(fetcher, searcher);
    this.congressAgent = new CongressAgent(searcher);
    this.legiScanAgent = new LegiScanAgent();
    this.openFecAgent = new OpenFecAgent();
    this.openCorporatesAgent = new OpenCorporatesAgent();
    this.muckRockAgent = new MuckRockAgent();
    this.usaSpendingAgent = new USASpendingAgent();
    this.reportAgent = new ReportAgent();
  }

  async researchCompany(companyName: string): Promise<{
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

    const sources: Source[] = [
      ...siteResult.sources,
      ...newsResult.sources,
      ...competitorResult.sources,
      ...corporateResult.sources,
      ...spendingResult.sources,
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
   */
  async researchPerson(personName: string, deep = false): Promise<{
    bundle: PersonResearchBundle;
    report: string;
  }> {
    const [result, corporateResult, foiaResult] = await Promise.all([
      this.peopleAgent.run(personName, deep),
      deep ? this.openCorporatesAgent.run(personName) : Promise.resolve({ affiliations: [], sources: [] }),
      deep ? this.muckRockAgent.run(personName) : Promise.resolve({ requests: [], sources: [] }),
    ]);

    const bundle: PersonResearchBundle = {
      query: personName,
      generatedAt: new Date().toISOString(),
      person: result.person,
      careerHistory: result.careerHistory,
      news: result.news,
      sources: [...result.sources, ...corporateResult.sources, ...foiaResult.sources],
      corporateAffiliations: corporateResult.affiliations.length > 0 ? corporateResult.affiliations : undefined,
      foiaRequests: foiaResult.requests.length > 0 ? foiaResult.requests : undefined,
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
   * Political research (Round 2, item 1): opposition research, district
   * makeup, approval ratings, voting record, campaign finance.
   * @param deep Charon Protocol (internal tier only) — deeper sourcing,
   *   including full-page reads for the top opposition-research sources.
   *
   * Round 2 v2: runs the search-synthesis political-agent alongside
   * three real API integrations (Congress.gov, LegiScan, OpenFEC).
   * Authoritative API data overrides the LLM-guessed profile fields
   * (office/party/state/district) where available; LegiScan needs a
   * state to resolve a legislative session, so it runs after
   * congress-agent/political-agent have had a chance to supply one.
   */
  async researchPolitical(name: string, deep = false): Promise<{
    bundle: PoliticalResearchBundle;
    report: string;
  }> {
    const [searchResult, congressResult, fecResult, foiaResult] = await Promise.all([
      this.politicalAgent.run(name, deep),
      this.congressAgent.run(name),
      this.openFecAgent.run(name),
      deep ? this.muckRockAgent.run(name) : Promise.resolve({ requests: [], sources: [] }),
    ]);

    const state = congressResult.state ?? searchResult.profile.state;
    const legiscanResult = await this.legiScanAgent.run(name, state);

    const sources: Source[] = [
      ...searchResult.sources,
      ...congressResult.sources,
      ...fecResult.sources,
      ...legiscanResult.sources,
      ...foiaResult.sources,
    ];

    const bundle: PoliticalResearchBundle = {
      query: name,
      generatedAt: new Date().toISOString(),
      profile: {
        ...searchResult.profile,
        office: congressResult.office ?? searchResult.profile.office,
        party: congressResult.party ?? legiscanResult.party ?? searchResult.profile.party,
        state: state ?? searchResult.profile.state,
        district: congressResult.district ?? legiscanResult.district ?? searchResult.profile.district,
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
