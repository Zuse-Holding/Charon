import { WebsiteAgent } from "../website-agent/index.js";
import { NewsAgent } from "../news-agent/index.js";
import { CompetitorAgent } from "../competitor-agent/index.js";
import { CorporateAgent } from "../corporate-agent/index.js";
import { PeopleAgent } from "../people-agent/index.js";
import { ProductAgent } from "../product-agent/index.js";
import { synthesizeRisksOpportunities } from "../synthesis-agent/index.js";
import { ReportAgent } from "../report-agent/index.js";
import { DeepDiveAgent, DeepDiveBundle } from "../deep-dive-agent/index.js";
import {
  DirectFetchProvider,
  SerperSearchProvider,
} from "../../lib/providers.js";
import {
  PersonResearchBundle,
  ProductResearchBundle,
  ResearchBundle,
  Source,
} from "../../types/research.js";

/**
 * Research Orchestrator
 * Receives a request, launches agent tasks, aggregates findings, hands
 * the bundle to the Report Agent.
 *
 * Two research modes:
 *   researchCompany()     — Quick profile (~30s). Parallel agents, fast.
 *   researchCompanyDeep() — Deep dive (~2–5min). Per-section LLM synthesis.
 */
export class ResearchOrchestrator {
  private websiteAgent: WebsiteAgent;
  private newsAgent: NewsAgent;
  private competitorAgent: CompetitorAgent;
  private corporateAgent: CorporateAgent;
  private peopleAgent: PeopleAgent;
  private productAgent: ProductAgent;
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
    this.reportAgent = new ReportAgent();
  }

  // ── Quick Profile ──────────────────────────────────────────────────
  async researchCompany(companyName: string): Promise<{
    bundle: ResearchBundle;
    report: string;
  }> {
    const [siteResult, newsResult, competitorResult, corporateResult] =
      await Promise.all([
        this.websiteAgent.run(companyName),
        this.newsAgent.run(companyName),
        this.competitorAgent.run(companyName),
        this.corporateAgent.run(companyName),
      ]);

    const sources: Source[] = [
      ...siteResult.sources,
      ...newsResult.sources,
      ...competitorResult.sources,
      ...corporateResult.sources,
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
    };

    const synthesis = await synthesizeRisksOpportunities(bundle);
    if (synthesis) {
      bundle.risks = synthesis.risks;
      bundle.opportunities = synthesis.opportunities;
    }

    const report = this.reportAgent.generate(bundle);
    return { bundle, report };
  }

  // ── Deep Dive ──────────────────────────────────────────────────────
  async researchCompanyDeep(companyName: string): Promise<{
    bundle: DeepDiveBundle;
    report: string;
  }> {
    const searcher = new SerperSearchProvider();
    const deepDiveAgent = new DeepDiveAgent(searcher);
    const bundle = await deepDiveAgent.run(companyName);
    const report = this.reportAgent.generateDeepDive(bundle);
    return { bundle, report };
  }

  // ── Person ─────────────────────────────────────────────────────────
  async researchPerson(personName: string): Promise<{
    bundle: PersonResearchBundle;
    report: string;
  }> {
    const result = await this.peopleAgent.run(personName);

    const bundle: PersonResearchBundle = {
      query: personName,
      generatedAt: new Date().toISOString(),
      person: result.person,
      careerHistory: result.careerHistory,
      news: result.news,
      sources: result.sources,
    };

    const report = this.reportAgent.generatePerson(bundle);
    return { bundle, report };
  }

  // ── Product ────────────────────────────────────────────────────────
  async researchProduct(productName: string): Promise<{
    bundle: ProductResearchBundle;
    report: string;
  }> {
    const bundle = await this.productAgent.run(productName);
    const report = this.reportAgent.generateProduct(bundle);
    return { bundle, report };
  }
}
