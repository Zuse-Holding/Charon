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
import { LittleSisAgent, LittleSisRelationshipEntry } from "../littlesis-agent/index.js";
import { DomainPostureAgent } from "../domain-posture-agent/index.js";
import { RelatedEntitiesAgent } from "../related-entities-agent/index.js";
import { PublicFilingsAgent, caseRole, fundNames, fundTargets, isHealthcare, nameVariants, rankCases, type CaseRecord } from "../public-filings-agent/index.js";

const INVESTMENT_FIRM = /\b(invest\w*|capital|equity|fund|sponsor|asset management|real estate investment|private equity|holdings)\b/i;
import { SecFilingsAgent, type SecFilings } from "../sec-filings-agent/index.js";
import { applyAppointments, appointmentsFromNews, checkFoundersAgainst, cleanLeadership, foundedBy, personKey, samePerson } from "../../lib/leadership.js";
import { officersFromFilings } from "../../lib/insiders.js";
import { entityTypeOf } from "../../lib/entity-type.js";
import { strongNameMatch } from "../../lib/name-match.js";
import { brandName } from "../../lib/news-noise.js";
import { contractCeilings } from "../../lib/contract-ceilings.js";
import { guardFromEnv } from "../../lib/exclusions/adapters.js";
import { siteOf } from "../../lib/provenance/findings.js";
import { cityOf, detectClosure, mergeClosure } from "../../lib/closure.js";
import { applyCompanyConsistency, applyPersonConsistency, plausibleAnalysis } from "../../lib/consistency.js";
import { hostOf, type SubjectRecord } from "../../lib/entities/subject.js";
import { synthesizeRisksOpportunities } from "../synthesis-agent/index.js";
import { ReportAgent } from "../report-agent/index.js";
import {
  DirectFetchProvider,
  SerperSearchProvider,
  SearchProvider,
} from "../../lib/providers.js";
import {
  CompanyAnchor,
  CreatorResearchBundle,
  NewsEntry,
  PersonResearchBundle,
  PoliticalResearchBundle,
  ProductResearchBundle,
  ResearchBundle,
  Source,
  WebArchiveSummary,
} from "../../types/research.js";
import { classifyOfficeType } from "../../lib/office-classifier.js";
import { isEnabled } from "../../lib/flags.js";
import { buildCompanyProvenance, buildPersonProvenance, type BuiltProvenance } from "../../lib/provenance/build.js";
import { recordSnapshots, type Snapshot } from "../../lib/provenance/snapshots.js";
import { CoverageRecorder, type ProgressListener } from "../../lib/coverage/recorder.js";
import { corporateActions } from "../../lib/corporate-actions.js";
import { SEC_OFF_REASON, secEnabled } from "../../lib/sec-http.js";
import { lookupStatewideExecutive } from "../../database/statewide-executives.js";
import { fillGaps } from "../../lib/gap-fill.js";
import { composeSummary } from "../../lib/summary.js";
import { applyProfile, loadProfile, profileFrom, saveProfile, suspiciousFounded } from "../../lib/profile-cache.js";
import { aboutNamesake, isFillerOpportunity, isNonRisk, isSaleRisk, isTabloidRisk, mergeRuleOpportunities, mergeRuleRisks, ruleOpportunities, ruleRisks } from "../../lib/risk-rules.js";

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
    this.reportAgent = new ReportAgent();
  }

  /**
   * @param proAccess 7/20 public-record fusion sources (sanctions
   *   screening, Wayback archive history, ProPublica nonprofit lookup,
   *   LittleSis power-mapping) — gated to Pro/Team/internal via
   *   TierConfig.publicRecordsAccess, checked by the caller.
   * @param deep Charon Protocol (internal tier only) — passed through to
   *   LittleSis for relationship pulling.
   * @param options.anchor City/state or website the user gave (Fix 1);
   *   the website and news searches are narrowed to it.
   */
  async researchCompany(companyName: string, proAccess = false, deep = false, options: { relatedHops?: number; onProgress?: ProgressListener; anchor?: CompanyAnchor } = {}): Promise<{
    bundle: ResearchBundle;
    report: string;
    // Charon/internal-only (deep) — LittleSis relationships (board/officer
    // positions, memberships, family ties, donations, ownership) for the
    // caller to feed into the Knowledge Graph. Not part of the report
    // itself, see littlesis-agent's doc comment.
    littleSisRelationships?: LittleSisRelationshipEntry[];
    /** Raw source responses for the caller to store (provenance flag on). */
    snapshots?: Snapshot[];
  }> {
    const cov = new CoverageRecorder(isEnabled("coverage"), "company", companyName, process.env, undefined, options.onProgress);
    const { value, snapshots } = await recordSnapshots(isEnabled("provenance"), () =>
      this.gatherCompany(companyName, proAccess, deep, cov, options.relatedHops, options.anchor ?? {}));
    const { bundle, littleSisRelationships } = value;
    bundle.coverage = cov.result();
    const stored = attachProvenance(bundle, snapshots, buildCompanyProvenance);
    const report = this.reportAgent.generate(bundle);
    return { bundle, report, littleSisRelationships, snapshots: stored };
  }

  private async gatherCompany(queryName: string, proAccess: boolean, deep: boolean, cov: CoverageRecorder, relatedHops: number | undefined, queryAnchor: CompanyAnchor): Promise<{
    bundle: ResearchBundle;
    littleSisRelationships?: LittleSisRelationshipEntry[];
  }> {
    // Resolve once, up front (Fix 1): the website step settles which
    // business this is (its domain and city), and every other source
    // searches and is checked against that one record.
    // SEC filings (launch fix 19) need only the name, so they run alongside
    // the website step; a website-only search waits for the site's name.
    const secEmpty = { filings: undefined, sources: [] } as Awaited<ReturnType<SecFilingsAgent["run"]>>;
    const secOn = secEnabled();
    if (!secOn) for (const id of ["edgar", "formd"]) cov.skip(id, SEC_OFF_REASON);
    const runSec = (name: string) => secOn
      ? cov.run("edgar", () => new SecFilingsAgent().run(name), secEmpty, (r) => (r.filings ? 1 : 0))
      : Promise.resolve(secEmpty);
    const secEarly = queryAnchor.nameFromSite ? undefined : runSec(queryName);
    const siteResult = await cov.run("website", () => this.websiteAgent.run(queryName, queryAnchor),
      { company: { name: queryName }, leadership: [], products: [], sources: [] },
      (r) => r.leadership.length + r.products.length + (r.company.description ? 1 : 0));
    // A website-only search is named by the site, and the site's own city
    // anchors every later source (round 2, Fix 1).
    const companyName = siteResult.company.name || queryName;
    const anchor: CompanyAnchor = siteResult.company.anchor ?? queryAnchor;
    const secResult = await (secEarly ?? runSec(companyName));
    const sec = secResult.filings;
    // A national company (an SEC filer, or one with many locations) isn't
    // tied to its HQ city (launch fixes 22, 23): news needn't name Clayton
    // to be about Graybar, and its peers are national, not local. A city
    // the user typed always holds.
    const national = !queryAnchor.location && (!!sec || !!siteResult.company.stockListing || !!siteResult.company.chain || isNationalScale(siteResult.company));
    const tieAnchor: CompanyAnchor = national ? { ...anchor, location: undefined } : anchor;
    const subject: SubjectRecord = { name: companyName, anchor: tieAnchor, domain: hostOf(siteResult.company.website), ticker: siteResult.company.stockListing?.split(/:\s*/)[1] };
    // Every name a registry may file it under (launch fixes 57, 60, 67):
    // the resolved name, the legal entity from its site or the SEC, and for
    // a national brand the short name the press and courts use ("Crumbl").
    const alias = national ? brandName(companyName, subject.domain) : undefined;
    const entityNames = [...new Set([companyName, siteResult.company.legalName, sec?.name, alias].filter((n): n is string => !!n))];
    if (alias) subject.aliases = [alias];
    // What the business is, for checking a short-name news match (fix 61).
    const profileTerms = [
      ...[siteResult.company.industry, siteResult.company.role].join(" ").split(/[^A-Za-z]+/).filter((w) => w.length >= 6),
      cityOf(siteResult.company.headquarters ?? anchor.location) ?? "",
      ...siteResult.leadership.map((l) => l.name.split(/\s+/).pop() ?? ""),
      ...(siteResult.company.legalName ? [siteResult.company.legalName] : []),
    ].filter((t) => t && t.length >= 4);
    console.log(`[entity] "${queryName}" -> ${entityNames.map((n) => `"${n}"`).join(", ")}`);
    // The site couldn't be read and nothing else tied the name to it:
    // nothing found by name alone stands in for it. A listing linking to the
    // site settles who it is, so news and peers still run (Crumbl, fix 25).
    const unreadable = !!siteResult.company.siteUnreadable && !!siteResult.company.thin;

    const [newsResult, competitorResult, corporateResult, spendingResult] =
      await Promise.all([
        unreadable ? Promise.resolve({ news: [], sources: [] })
          : cov.run("news", () => this.newsAgent.run(companyName, tieAnchor, subject.domain, { aliases: subject.aliases, profileTerms }), { news: [], sources: [] }, (r) => r.news.length),
        unreadable ? Promise.resolve({ competitors: [], sources: [] })
          : cov.run("competitors", () => this.competitorAgent.run(companyName, subject, {
            role: siteResult.company.role,
            industry: siteResult.company.industry,
            description: siteResult.company.description,
            headquarters: siteResult.company.headquarters ?? anchor.location,
            // Matched on a city or its own site, and not national in scale:
            // a local or regional business, whose peers are the ones near it.
            local: !national && !!(anchor.location || anchor.website),
            products: siteResult.products.map((p) => p.name),
            filed: sec?.competitors?.length && sec.tenKUrl ? { names: sec.competitors, url: sec.tenKUrl } : undefined,
          }), { competitors: [], sources: [] }, (r) => r.competitors.length),
        cov.run("sec", () => this.corporateAgent.run(companyName, subject), { funding: [], insiderActivity: [], sources: [] },
          (r) => r.funding.length + r.insiderActivity.length + (r.ownership ? 1 : 0)),
        // Free public API, no tier gating — every research run gets this.
        cov.run("usaspending", () => this.usaSpendingAgent.run(companyName, entityNames), { awards: [], sources: [] }, (r) => r.awards.length),
      ]);

    const website = siteResult.company.website;
    const siteHost = website ? hostname(website) : undefined;
    if (!proAccess) {
      for (const id of ["sanctions", "nonprofits", "littlesis"]) cov.skip(id, "Included with Pro.");
      cov.skip("wayback", "Included with Pro.", siteHost ?? companyName);
    } else if (!website) {
      cov.skip("wayback", "No company website was found to look up.");
    }

    // Public-record fusion sources — Pro/Team+ only. Wayback needs a
    // resolved website URL, which only exists once siteResult is in, so
    // this batch runs after the first Promise.all rather than alongside it.
    // Passive domain check (Feature 5): public records only, every plan.
    const domain = siteHost ? siteOf(siteHost) : undefined;
    const checkDomain = isEnabled("domain_posture");
    if (checkDomain && !domain) cov.skip("domain", "No company website was found to check.");

    // Related entities (Feature 4): public filings, every plan. Anything
    // on the self-exclusion list (Feature 6) is never followed.
    const guard = isEnabled("self_exclusion") ? guardFromEnv() : undefined;
    const related = isEnabled("related_entities")
      ? cov.run("related", () => new RelatedEntitiesAgent().run(companyName, {
          hops: relatedHops,
          mayFollow: guard ? async (_kind, value) => !(await guard.blocksQuery(value)) : undefined,
        }), { sources: [] }, (r) => r.graph ? r.graph.nodes.length - 1 : 0)
      : Promise.resolve({ graph: undefined, sources: [] });

    // Registry checks (launch fixes 12-16). Courts, NLRB and Form D are
    // public-record fusion sources like sanctions (Pro and up); the NPI
    // registry and the state formation record fill basic facts on every plan.
    const filings = new PublicFilingsAgent(this.searcher);
    const hq = siteResult.company.headquarters ?? anchor.location;
    const stateCode = hq?.match(/,\s*([A-Z]{2})\b/)?.[1];
    // State records live in the state of incorporation, which the 10-K
    // gives (Graybar: New York, not its Missouri HQ).
    const recordState = sec?.stateOfIncorporation ?? stateCode;
    const healthcare = isHealthcare([siteResult.company.industry, siteResult.company.role, siteResult.company.description].filter(Boolean).join(" "));
    if (!proAccess) for (const id of ["courtlistener", "nlrb", "formd"]) cov.skip(id, "Included with Pro.");
    if (!healthcare) cov.skip("npi", "Not a healthcare business.");
    if (siteResult.company.founded) cov.skip("state-records", "Founding year already on the company's own site.");
    const franchisor = !!siteResult.company.chain || /\bfranchis/i.test(`${siteResult.company.description ?? ""} ${siteResult.company.industry ?? ""} ${siteResult.company.role ?? ""}`);
    if (!franchisor) cov.skip("fdd", "Not a franchisor.");
    const fundTexts = [siteResult.company.description ?? "", ...siteResult.products.map((p) => `${p.name} ${p.description ?? ""}`),
      ...newsResult.news.map((n) => `${n.headline} ${n.summary ?? ""}`)];
    // An investment sponsor's funds file under its short name (launch fix 47).
    const sponsor = INVESTMENT_FIRM.test(`${companyName} ${siteResult.company.industry ?? ""} ${siteResult.company.role ?? ""}`);
    const registry = Promise.all([
      proAccess ? cov.run("courtlistener", () => filings.courtCases(companyName, entityNames), { cases: [], sources: [] }, (r) => r.cases.length) : Promise.resolve({ cases: [], sources: [] }),
      proAccess ? cov.run("nlrb", () => filings.nlrbCases(companyName, entityNames), { cases: [], sources: [] }, (r) => r.cases.length) : Promise.resolve({ cases: [], sources: [] }),
      healthcare ? cov.run("npi", () => filings.npiRecords(companyName, stateCode), { records: [], sources: [] }, (r) => r.records.length) : Promise.resolve({ records: [], sources: [] }),
      siteResult.company.founded ? Promise.resolve({ record: undefined, sources: [] })
        : cov.run("state-records", () => filings.stateFormation(siteResult.company.legalName ?? companyName, recordState), { record: undefined, sources: [] }, (r) => (r.record ? 1 : 0)),
      franchisor ? cov.run("fdd", () => filings.fddFigures(companyName), { fdd: undefined, sources: [] }, (r) => (r.fdd ? 1 : 0))
        : Promise.resolve({ fdd: undefined, sources: [] }),
      proAccess && secOn ? cov.run("formd", () => filings.formDFilings([...new Set([...entityNames.filter((n) => n !== alias), ...nameVariants(companyName), ...fundNames(fundTexts, companyName)])], sponsor ? companyName.split(/\s+/)[0] : undefined), { funding: [], sources: [] }, (r) => r.funding.length)
        : Promise.resolve({ funding: [], sources: [] }),
    ]);

    const [sanctionsResult, waybackResult, nonprofitResult, littleSisResult, postureResult, relatedResult] =
      await Promise.all([
        proAccess
          ? cov.run("sanctions", () => this.sanctionsAgent.run(companyName), { matches: [], sources: [], unavailable: true }, (r) => r.matches.length)
          : Promise.resolve({ matches: [], sources: [], unavailable: false }),
        proAccess && website
          ? cov.run("wayback", () => this.waybackAgent.run(website), { summary: {} as WebArchiveSummary, sources: [] },
            (r) => r.summary.snapshotCount ?? 0, siteHost)
          : Promise.resolve({ summary: {} as WebArchiveSummary, sources: [] }),
        proAccess
          ? cov.run("nonprofits", () => this.nonprofitAgent.run(companyName, stateCode), { organizations: [], sources: [] } as Awaited<ReturnType<ProPublicaNonprofitAgent["run"]>>, (r) => r.organizations.length)
          : Promise.resolve({ organizations: [], financials: undefined, sources: [] }),
        proAccess
          ? cov.run("littlesis", () => this.littleSisAgent.run(companyName, "company", deep),
            { matches: [], relationships: [], sources: [] }, (r) => r.matches.length)
          : Promise.resolve({ matches: [], relationships: [], sources: [] }),
        checkDomain && domain
          ? cov.run("domain", () => new DomainPostureAgent().run(domain, siteResult.company.emailDomain), { sources: [] }, (r) => r.posture?.checks.length ?? 0, domain)
          : Promise.resolve({ posture: undefined, sources: [] }),
        related,
      ]);

    const [courtResult, nlrbResult, npiResult, formationResult, fddResult, formDResult] = await registry;

    const sources: Source[] = [
      ...secResult.sources,
      ...courtResult.sources,
      ...nlrbResult.sources,
      ...npiResult.sources,
      ...formationResult.sources,
      ...formDResult.sources,
      ...fddResult.sources,
      ...siteResult.sources,
      ...newsResult.sources,
      ...competitorResult.sources,
      ...corporateResult.sources,
      ...spendingResult.sources,
      ...sanctionsResult.sources,
      ...waybackResult.sources,
      ...nonprofitResult.sources,
      ...littleSisResult.sources,
      ...postureResult.sources,
      ...relatedResult.sources,
    ];

    const bundle: ResearchBundle = {
      query: companyName,
      generatedAt: new Date().toISOString(),
      company: siteResult.company,
      leadership: siteResult.leadership,
      products: siteResult.products,
      news: newsResult.news,
      funding: [...corporateResult.funding, ...formDResult.funding],
      
      competitors: competitorResult.competitors,
      ownership: corporateResult.ownership,
      sources,
      federalSpending: spendingResult.awards,
      insiderActivity: corporateResult.insiderActivity,
      sanctionsMatches: sanctionsResult.matches.length > 0 ? sanctionsResult.matches : undefined,
      sanctionsUnavailable: sanctionsResult.unavailable || undefined,
      sanctionsScreened: (proAccess && !sanctionsResult.unavailable) || undefined,
      sanctionsRuledOut: "ruledOut" in sanctionsResult && sanctionsResult.ruledOut ? sanctionsResult.ruledOut : undefined,
      webArchive: waybackResult.summary.snapshotCount ? waybackResult.summary : undefined,
      nonprofitFilings: nonprofitResult.organizations.length > 0 ? nonprofitResult.organizations : undefined,
      // Only this organization's own LittleSis record (launch fix 40).
      powerMapConnections: orgMatches(littleSisResult.matches, companyName),
      domainPosture: postureResult.posture,
      relatedEntities: relatedResult.graph,
      // Most material first (launch fix 21). Government actions from agency
      // sites join them (launch fix 62).
      courtCases: (() => {
        const all = [...courtResult.cases, ...nlrbResult.cases, ...enforcementCases(newsResult.news, entityNames)];
        return all.length ? rankCases(all) : undefined;
      })(),
      secFilings: sec,
      fdd: fddResult.fdd,
      npiRecords: npiResult.records.length ? npiResult.records : undefined,
      nonprofitFinancials: nonprofitResult.financials,
    };
    if (sec) applySecFilings(bundle, sec);
    // A founding year after its own domain was registered is a misread
    // (round 10: Limbach "2019"); drop it so the saved profile or the
    // gap-fill pass supplies the real one.
    if (suspiciousFounded(bundle)) {
      console.log(`[founded] "${companyName}": ${bundle.company.founded} is after the domain's registration; dropped`);
      bundle.company.founded = undefined;
      bundle.company.foundedSource = undefined;
    }
    // Saved, sourced basics from earlier runs (round 10).
    const cacheOn = isEnabled("fact_cache") && !!domain;
    const savedProfile = cacheOn ? await loadProfile(domain) : undefined;
    const fromCache = applyProfile(bundle, savedProfile);
    if (fromCache.length) console.log(`[profile-cache] "${companyName}": ${fromCache.join("; ")}`);
    // A company it bought is not a competitor (launch fix 65: Graybar listed
    // Metro Electric Supply, acquired in 2021, in the same report).
    const ownTexts = [bundle.company.description ?? "", sec?.description ?? "", ...bundle.news.map((n) => `${n.headline}. ${n.summary ?? ""}`),
      ...bundle.products.map((p) => `${p.name}. ${p.description ?? ""}`)];
    const bought = bundle.competitors.filter((c) => acquiredBy(ownTexts, c.name));
    if (bought.length) {
      console.log(`[competitors] "${companyName}": dropped ${bought.map((c) => c.name).join(", ")} (acquired)`);
      bundle.competitors = bundle.competitors.filter((c) => !bought.includes(c));
    }
    // Ownership already collected but never shown (launch fix 68: Patagonia's
    // Purpose Trust and Holdfast Collective came back from LittleSis).
    if (!bundle.ownership) {
      const found = ownershipFrom([
        ...(orgMatches(littleSisResult.matches, companyName) ?? []).filter((m) => m.blurb).map((m) => ({ text: m.blurb!, url: m.url })),
        // Its own pages too (launch fix 78: ACCO's employee ownership disappeared).
        ...(bundle.company.website ? [bundle.company.description ?? "", ...bundle.products.map((p) => `${p.name}. ${p.description ?? ""}`)]
          .filter(Boolean).map((text) => ({ text, url: bundle.company.website! })) : []),
        ...bundle.news.filter((n) => n.url).map((n) => ({ text: `${n.headline}. ${n.summary ?? ""}`, url: n.url! })),
      ]);
      if (found) {
        bundle.ownership = found.note;
        const src = bundle.sources.find((x) => x.url === found.url);
        if (src) { if (!src.usedFor.includes("funding")) src.usedFor.push("funding"); }
        else bundle.sources.push({ url: found.url, title: "Ownership", retrievedAt: new Date().toISOString(), usedFor: ["funding"] });
      }
    }
    // Second, targeted search for what's still empty (round 10).
    const gapFill = isEnabled("gap_fill")
      ? await fillGaps(bundle, this.searcher, [...new Set([companyName, ...(alias ? [alias] : []), ...entityNames])], domain)
      : { filled: [], actionTexts: [], ownershipTexts: [] };
    // Who owns it, from the targeted search (ACCO's ESOP came and went).
    if (!bundle.ownership && gapFill.ownershipTexts?.length) {
      const found = ownershipFrom(gapFill.ownershipTexts, [companyName, ...entityNames]);
      if (found) {
        bundle.ownership = found.note;
        bundle.sources.push({ url: found.url, title: "Ownership", retrievedAt: new Date().toISOString(), usedFor: ["funding"] });
        console.log(`[gap-fill] "${companyName}": ownership ${found.note}`);
      }
    }
    // Acquisitions, subsidiaries and brands (launch fix 80).
    const actions = corporateActions([
      ...gapFill.actionTexts,
      ...bundle.news.filter((n) => n.url).map((n) => ({ text: `${n.headline}. ${n.summary ?? ""}`, url: n.url!, date: n.date })),
      ...(bundle.company.website ? [bundle.company.description ?? "", ...bundle.products.map((p) => `${p.name}. ${p.description ?? ""}`)]
        .filter(Boolean).map((text) => ({ text, url: bundle.company.website! })) : []),
    ], entityNames);
    if (actions.length) {
      bundle.corporateActions = actions;
      // A company it bought is no longer a competitor.
      bundle.competitors = bundle.competitors.filter((c) => !actions.some((a) => a.name.toLowerCase() === c.name.toLowerCase()));
    }
    // Fund targets the company's own pages or the news state (launch fix 47).
    const targets = fundTargets([
      ...siteResult.products.map((p) => ({ text: `${p.name}. ${p.description ?? ""}`, url: p.sourceUrl })),
      { text: siteResult.company.description ?? "", url: siteResult.company.website },
      ...newsResult.news.map((n) => ({ text: `${n.headline}. ${n.summary ?? ""}`, url: n.url, date: n.date })),
    ], companyName);
    for (const t of targets) {
      if (!t.url) continue;
      bundle.funding.push({ round: t.round, amount: t.amount, date: t.date });
      const src = bundle.sources.find((x) => x.url === t.url);
      if (src) { if (!src.usedFor.includes("funding")) src.usedFor.push("funding"); }
      else bundle.sources.push({ url: t.url, title: t.round, retrievedAt: new Date().toISOString(), usedFor: ["funding"] });
    }
    // A state record's formation date when the site gives none (fix 15);
    // before the entity type, which checks rounds against it.
    if (!bundle.company.founded && formationResult.record) {
      bundle.company.founded = formationResult.record.date.slice(0, 4);
      bundle.company.foundedSource = formationResult.record.url;
    }
    applyEntityType(bundle, franchisor);
    const ceilings = contractCeilings(bundle.federalSpending ?? [], bundle.news);
    if (ceilings.length) bundle.contractCeilings = ceilings;
    // The NPI's authorized official is a named owner (fix 14).
    for (const r of npiResult.records) {
      const name = r.official?.split(",")[0];
      if (name && !bundle.leadership.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
        bundle.leadership.push({ name, title: r.official!.split(",").slice(1).join(",").trim() || "Authorized official (NPI record)", sourceUrl: r.url });
        bundle.sources.push({ url: r.url, title: `NPPES NPI registry — ${r.name}`, retrievedAt: new Date().toISOString(), usedFor: ["leadership"] });
      }
    }
    // Officers from the 10-K and NPI joined the site's list: one entry per
    // person again, and former officers off it (launch fix 35).
    // Appointments in the news are dated, so they settle title conflicts
    // with an undated page (launch fix 44: Darway's promotion at ACCO).
    const appointed = appointmentsFromNews(bundle.news);
    if (appointed.length) console.log(`[leadership] "${companyName}": ${appointed.map((a) => `${a.name} (${a.title})`).join(", ")} from news`);
    // Officers the insider filings name (launch fix 83: Limbach's CFO).
    const filers = officersFromFilings(bundle.insiderActivity ?? []).filter((o) => !bundle.leadership.some((l) => samePerson(l.name, o.name)));
    bundle.leadership = cleanLeadership(applyAppointments([...bundle.leadership, ...filers], appointed), subject.domain, national);
    bundle.leadership = checkFoundersAgainst(bundle.leadership, foundedBy([
      bundle.company.description ?? "", sec?.description ?? "",
      ...bundle.leadership.map((l) => l.bio ?? ""), ...bundle.news.map((n) => `${n.headline}. ${n.summary ?? ""}`),
    ]));

    // Closure can surface in news as well as on the business's own pages.
    const city = cityOf(anchor.location);
    bundle.company.closure ??= detectClosure(
      bundle.news.map((n) => ({ text: `${n.headline}. ${n.summary ?? ""}`, url: n.url ?? "" })).filter((n) => n.url),
      companyName, city);
    // One source saying it closed isn't confirmation (round 2, Fix 5):
    // look once for a second before the report states it.
    if (bundle.company.closure && bundle.company.closure.sources < 2) {
      const more = await this.searcher.search(`"${companyName}"${city ? ` ${city}` : ""} closed`, 5);
      bundle.company.closure = mergeClosure(bundle.company.closure,
        more.map((r) => ({ text: `${r.title}. ${r.snippet ?? ""}`, url: r.url })), companyName, city);
    }

    // Consistency pass before synthesis and output: anything not tied to
    // the resolved record, or out of scale for it, is dropped.
    const { dropped } = applyCompanyConsistency(bundle, subject);
    if (dropped.length) console.log(`[consistency] "${companyName}" — dropped ${dropped.join("; ")}`);

    // Risks/Opportunities is pure LLM synthesis with no heuristic
    // fallback — see synthesis-agent for why. Runs after the rest of
    // the bundle is assembled since it needs the full picture as input.
    // A thin report has nothing tied to the business to analyse.
    const synthesis = bundle.company.thin ? null : await synthesizeRisksOpportunities(bundle);
    const nameSet = [...new Set([companyName, ...entityNames])];
    if (synthesis) {
      // Personal-life items and discount sales are never risks; restated
      // offerings, praise and the namesake region are never opportunities (round 10).
      bundle.risks = plausibleAnalysis(synthesis.risks, bundle, synthesis.facts).filter((r) => !isTabloidRisk(r) && !isSaleRisk(r) && !isNonRisk(r));
      bundle.opportunities = sameRecordOnce(plausibleAnalysis(synthesis.opportunities, bundle, synthesis.facts).filter((o) => !isFillerOpportunity(o) && !aboutNamesake(o, nameSet)), synthesis.citations);
      console.log(`[synthesis] "${companyName}": ${bundle.risks.length} risk(s), ${bundle.opportunities.length} opportunit(ies) after the consistency check`);
      bundle.synthesisCitations = synthesis.citations;
      // Same drift checks as the analysis: nothing the facts don't state.
      const [summary] = synthesis.summary ? plausibleAnalysis([synthesis.summary], bundle, synthesis.facts) : [];
      if (summary) bundle.company.summary = summary;
    }
    // Signals in the data that the model left out (round 10): insider
    // selling, a 990 squeeze, falling revenue or margin, closures, open
    // suits, enforcement, one-buyer concentration.
    if (!bundle.company.thin) {
      const rules = ruleRisks(bundle, nameSet);
      const merged = mergeRuleRisks(bundle.risks ?? [], bundle.synthesisCitations ?? {}, rules);
      const added = merged.risks.length - (bundle.risks?.length ?? 0);
      if (added > 0) {
        console.log(`[risk-rules] "${companyName}": added ${added} risk(s) from the data`);
        bundle.risks = merged.risks;
        bundle.synthesisCitations = merged.citations;
        for (const u of Object.values(merged.citations).flat()) {
          const src = bundle.sources.find((x) => x.url === u);
          if (src && !src.usedFor.includes("risks")) src.usedFor.push("risks");
        }
      }
    }
    // Opportunities in the data the model left out (round 12: Gecko's
    // $300M Navy ceiling and new plant, under "insufficient data").
    if (!bundle.company.thin) {
      const rules = ruleOpportunities(bundle, nameSet).filter((r) => !isFillerOpportunity(r.text));
      const merged = mergeRuleOpportunities(bundle.opportunities ?? [], bundle.synthesisCitations ?? {}, rules);
      const added = merged.opportunities.length - (bundle.opportunities?.length ?? 0);
      if (added > 0) {
        console.log(`[risk-rules] "${companyName}": added ${added} opportunit(ies) from the data`);
        bundle.opportunities = merged.opportunities;
        bundle.synthesisCitations = merged.citations;
        for (const u of Object.values(merged.citations).flat()) {
          const src = bundle.sources.find((x) => x.url === u);
          if (src && !src.usedFor.includes("opportunities")) src.usedFor.push("opportunities");
        }
      }
    }
    // No model summary survived its checks: state the report's own facts
    // instead of opening on the site's tagline (round 12).
    if (!bundle.company.thin && (!bundle.company.summary || bundle.company.summary === bundle.company.description)) {
      const composed = composeSummary(bundle);
      if (composed) bundle.company.summary = composed;
    }
    if (cacheOn && domain) await saveProfile(profileFrom(bundle, domain, savedProfile));

    return {
      bundle,
      littleSisRelationships: littleSisResult.relationships.length > 0 ? littleSisResult.relationships : undefined,
    };
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
  async researchPerson(personName: string, deep = false, affiliation?: string, proAccess = false, options: { onProgress?: ProgressListener } = {}): Promise<{
    bundle: PersonResearchBundle;
    report: string;
    // Charon/internal-only (deep) — see researchCompany's same field.
    littleSisRelationships?: LittleSisRelationshipEntry[];
    snapshots?: Snapshot[];
  }> {
    const cov = new CoverageRecorder(isEnabled("coverage"), "person", personName, process.env, undefined, options.onProgress);
    const { value, snapshots } = await recordSnapshots(isEnabled("provenance"), () =>
      this.gatherPerson(personName, deep, affiliation, proAccess, cov));
    const { bundle, littleSisRelationships } = value;
    bundle.coverage = cov.result();
    const stored = attachProvenance(bundle, snapshots, buildPersonProvenance);
    const report = this.reportAgent.generatePerson(bundle);
    return { bundle, report, littleSisRelationships, snapshots: stored };
  }

  private async gatherPerson(personName: string, deep: boolean, affiliation: string | undefined, proAccess: boolean, cov: CoverageRecorder): Promise<{
    bundle: PersonResearchBundle;
    littleSisRelationships?: LittleSisRelationshipEntry[];
  }> {
    if (!deep) for (const id of ["opencorporates", "muckrock"]) cov.skip(id, "Searched automatically on the Charon plan.");
    if (!proAccess) for (const id of ["sanctions", "nonprofits", "littlesis"]) cov.skip(id, "Included with Pro.");
    const [result, corporateResult, foiaResult, sanctionsResult, nonprofitResult, littleSisResult] = await Promise.all([
      cov.run("people", () => this.peopleAgent.run(personName, deep, affiliation),
        { person: { name: personName }, careerHistory: [], news: [], sources: [] },
        (r) => r.careerHistory.length + r.news.length + (r.person.currentRole ? 1 : 0)),
      deep
        ? cov.run("opencorporates", () => this.openCorporatesAgent.run(personName), { affiliations: [], sources: [] }, (r) => r.affiliations.length)
        : Promise.resolve({ affiliations: [], sources: [] }),
      deep
        ? cov.run("muckrock", () => this.muckRockAgent.run(personName), { requests: [], sources: [] }, (r) => r.requests.length)
        : Promise.resolve({ requests: [], sources: [] }),
      proAccess
        ? cov.run("sanctions", () => this.sanctionsAgent.run(personName), { matches: [], sources: [], unavailable: true }, (r) => r.matches.length)
        : Promise.resolve({ matches: [], sources: [], unavailable: false }),
      proAccess
        ? cov.run("nonprofits", () => this.nonprofitAgent.run(personName), { organizations: [], sources: [] }, (r) => r.organizations.length)
        : Promise.resolve({ organizations: [], sources: [] }),
      proAccess
        ? cov.run("littlesis", () => this.littleSisAgent.run(personName, "person", deep),
          { matches: [], relationships: [], sources: [] }, (r) => r.matches.length)
        : Promise.resolve({ matches: [], relationships: [], sources: [] }),
    ]);

    const bundle: PersonResearchBundle = {
      query: personName,
      generatedAt: new Date().toISOString(),
      person: result.person,
      careerHistory: result.careerHistory,
      news: result.news,
      sources: [
        ...result.sources, ...corporateResult.sources, ...foiaResult.sources,
        ...sanctionsResult.sources, ...nonprofitResult.sources, ...littleSisResult.sources,
      ],
      corporateAffiliations: corporateResult.affiliations.length > 0 ? corporateResult.affiliations : undefined,
      foiaRequests: foiaResult.requests.length > 0 ? foiaResult.requests : undefined,
      sanctionsMatches: sanctionsResult.matches.length > 0 ? sanctionsResult.matches : undefined,
      sanctionsUnavailable: sanctionsResult.unavailable || undefined,
      sanctionsScreened: (proAccess && !sanctionsResult.unavailable) || undefined,
      sanctionsRuledOut: "ruledOut" in sanctionsResult && sanctionsResult.ruledOut ? sanctionsResult.ruledOut : undefined,
      nonprofitFilings: nonprofitResult.organizations.length > 0 ? nonprofitResult.organizations : undefined,
      powerMapConnections: littleSisResult.matches.length > 0 ? littleSisResult.matches : undefined,
    };

    applyPersonConsistency(bundle);

    return {
      bundle,
      littleSisRelationships: littleSisResult.relationships.length > 0 ? littleSisResult.relationships : undefined,
    };
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

    // Fallback literals below spell out every optional field the real
    // agent result can have (as explicit `undefined`) rather than just
    // `{ sponsoredLegislation: [], sources: [] }` etc — TS infers a
    // fallback's type from the literal alone with no contextual typing
    // here, so an object missing a key entirely (vs. having it as
    // `undefined`) produces a narrower type than the real result, and
    // the union access below (`congressResult.state`, `fecResult.summary`,
    // `statewideResult.office`, ...) fails to compile. No behavior change
    // — a missing optional key already read as `undefined`.
    const [searchResult, congressResult, fecResult, foiaResult, statewideResult] = await Promise.all([
      this.politicalAgent.run(name, deep),
      runFederalSources
        ? this.congressAgent.run(name)
        : Promise.resolve({ sponsoredLegislation: [], office: undefined, party: undefined, state: undefined, district: undefined, sources: [] }),
      runFederalSources
        ? this.openFecAgent.run(name)
        : Promise.resolve({ summary: undefined, donorBreakdown: [], sources: [] }),
      deep ? this.muckRockAgent.run(name) : Promise.resolve({ requests: [], sources: [] }),
      runStatewideLookup
        ? lookupStatewideExecutive(name)
        : Promise.resolve({ found: false, office: undefined, party: undefined, state: undefined, termStart: undefined, sourceUrl: undefined }),
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

/**
 * Builds and attaches provenance when the run was recorded. Provenance must
 * never cost a user their report: if building it fails, the report ships
 * without it and the error is logged.
 */
function attachProvenance<B extends { provenance?: BuiltProvenance["record"] }>(
  bundle: B,
  snapshots: Snapshot[] | null,
  build: (b: B, s: Snapshot[]) => BuiltProvenance,
): Snapshot[] | undefined {
  if (!snapshots) return undefined;
  try {
    const built = build(bundle, snapshots);
    bundle.provenance = built.record;
    return built.snapshots;
  } catch (err) {
    console.error("[provenance] build failed; report continues without it:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

// Many locations, or says it works nationally: not a local business.
const NATIONAL = /\b\d{2,}\+?\s+(locations|branches|offices|distribution centers|facilities|stores|warehouses)\b|\bnationwide\b|\bacross the (u\.?s\.?|united states|country)\b|\b(global|worldwide|international|multinational|fortune 500)\b|\b(nasdaq|nyse)\b|\bpublicly (traded|held|listed)\b|\bnorth america(n)?\b/i;

export function isNationalScale(c: { locations?: string[]; description?: string; summary?: string }): boolean {
  return (c.locations?.length ?? 0) >= 5 || NATIONAL.test(`${c.description ?? ""} ${c.summary ?? ""}`);
}

/**
 * What the 10-K settles (launch fixes 19, 23): founding and incorporation,
 * the business address as HQ when nothing else gave one, and the executive
 * officers as leadership, cited to the 10-K.
 */
/** The texts say the company acquired this one. */
export function acquiredBy(texts: string[], name: string): boolean {
  const core = name.replace(/,?\s+(inc\.?|llc|corp\.?|co\.?|company)$/i, "").trim();
  if (core.length < 3) return false;
  const n = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(acquir\\w*|bought|purchas\\w*|merged with)\\b[^.]{0,80}\\b${n}\\b|\\b${n}\\b[^.]{0,60}\\b(was |has been )?(acquired|bought|purchased)\\b`, "i");
  return texts.some((t) => re.test(t));
}

/** "Owned by X", "ownership transferred to X": a note and the page that says it. */
// An owner phrase that is a funding round or the company itself is a misread
// (round 12: "It is owned by Series Gecko Robotics and").
// "Private Equity firm Blackstone" is a real owner, so "private" isn't here.
const NOT_AN_OWNER = /^(the\s+)?(series|seed|round|funding|founders?|investors?|venture|capital|public|employees?)\b/i;
const bareOwner = (t: string) => t.toLowerCase().replace(/^the\s+/, "").replace(/,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/, "").trim();

/**
 * One item per record: an item whose cited sources were all cited by an
 * earlier item, and which repeats its dollar figure, says the same thing
 * again (round 12: Gecko's $300M ceiling as three opportunities).
 */
export function sameRecordOnce(items: string[], citations: Record<string, string[]>): string[] {
  const out: string[] = [];
  const figures = (t: string) => new Set(t.match(/\$\d[\d,.]*\s*(?:million|billion|[mbk])?/gi)?.map((x) => x.toLowerCase().replace(/\s+/g, "").replace(/million$/, "m").replace(/billion$/, "b")) ?? []);
  for (const it of items) {
    const urls = citations[it] ?? [];
    const figs = figures(it);
    const repeat = out.some((o) => {
      const prior = citations[o] ?? [];
      const shareUrl = urls.length > 0 && urls.every((u) => prior.includes(u));
      const shareFig = [...figs].some((f) => figures(o).has(f));
      return shareFig && (shareUrl || urls.some((u) => prior.includes(u)));
    });
    if (!repeat) out.push(it);
  }
  return out;
}

export function ownershipFrom(items: { text: string; url: string }[], names: string[] = []): { note: string; url: string } | undefined {
  // "100% employee-owned", "an ESOP company".
  for (const it of items) {
    if (/\b(employee[- ]owned|employee stock ownership plan|ESOP|owned by (its |our )?(employees|associates))\b/i.test(it.text)) {
      return { note: /\b(ESOP|employee stock ownership plan)\b/i.test(it.text) ? "Employee-owned (ESOP)" : "Employee-owned", url: it.url };
    }
  }
  // Lowercase words may sit between "owned by" and the owner (launch fix
  // 78: "owned by a non profit corporations since 2022, the Patagonia
  // Purpose Trust and Holdfast Collective").
  const re = /\b(?:(?:is |are )?(?:owned|controlled) by(?:\s+[a-z][\w-]*|\s+\d{4},?|,){0,10}?|ownership (?:was |has been )?(?:transferred|given) to|subsidiary of|gave (?:away )?(?:the |his |her )?company to|transferred (?:the company|ownership|its (?:voting )?stock) to)\s+((?:the\s+)?[A-Z][\w&'’.-]*(?:\s+(?:[A-Z][\w&'’.-]*|and|of|the|firm)){0,6})/;
  for (const it of items) {
    const m = it.text.match(re);
    if (m) {
      const owners = m[1].replace(/[.,;:]+$/, "").replace(/\s+(and|of|the)$/i, "").trim();
      // Only the company itself is a misread: an owner whose name contains
      // it ("the Patagonia Purpose Trust") is a real one.
      if (NOT_AN_OWNER.test(owners) || names.some((n) => n && bareOwner(n).includes(bareOwner(owners)))) continue;
      return { note: `Owned by ${owners}`, url: it.url };
    }
  }
  return undefined;
}

/**
 * DOJ, SEC, FTC, EPA, OSHA and DOL items as case records (launch fix 62):
 * "United States v. ACCO Engineered Systems, Inc." is a suit against it.
 */
export function enforcementCases(news: NewsEntry[], names: string[]): CaseRecord[] {
  return news.filter((n) => n.enforcement && n.url).map((n) => {
    let agency = "Federal agency";
    try { agency = new URL(n.url!).hostname.replace(/^www\./, ""); } catch { /* keep generic */ }
    const role = caseRole(n.headline, names);
    // An OSHA inspection is a record of one, not a charge.
    const inspection = /osha\.gov/i.test(agency) && /establishment|inspection/i.test(n.url!);
    return {
      caption: n.headline,
      court: AGENCY_NAMES[agency] ?? agency,
      filed: n.date,
      url: n.url!,
      // "Patagonia v. United States" is its own suit, not a charge.
      role: inspection ? "unknown" : role === "unknown" ? "charged" : role,
      caseType: inspection ? "OSHA inspection" : "Government enforcement",
    };
  });
}

const AGENCY_NAMES: Record<string, string> = {
  "justice.gov": "U.S. Department of Justice", "sec.gov": "SEC", "ftc.gov": "FTC", "epa.gov": "EPA",
  "osha.gov": "OSHA", "dol.gov": "U.S. Department of Labor", "eeoc.gov": "EEOC",
};

function orgMatches<T extends { name: string; entityKind?: string }>(matches: T[], companyName: string): T[] | undefined {
  const kept = matches.filter((m) => m.entityKind !== "Person" && strongNameMatch(m.name, companyName));
  return kept.length ? kept : undefined;
}

const EARLY_ROUND = /\b(pre-?seed|seed|angel|series [a-h])\b/i;
const MAX_VENTURE_AGE = 25;
const NON_INVESTOR_OWNER = /\b(trust|collective|foundation|non-?profit|employee-owned|ESOP)\b/i;

/**
 * Entity type before Funding is filled (launch fix 34). A nonprofit's
 * rounds are someone else's (Homeboy's "Series B: $76M"), so none are
 * kept; its 990 figures and a public company's filed financials are what
 * the Funding section cites.
 */
export function applyEntityType(bundle: ResearchBundle, franchisor: boolean, now = new Date()): void {
  // A venture round decades after founding is a namesake's (launch fix 77:
  // Patagonia, founded 1973, kept "Seed" and "Series B" rounds).
  const founded = Number(bundle.company.founded?.match(/\b(1[89]|20)\d{2}\b/)?.[0]);
  if (founded) {
    const before = bundle.funding.length;
    bundle.funding = bundle.funding.filter((f) => !EARLY_ROUND.test(f.round ?? "")
      || (Number(f.date?.match(/\b(19|20)\d{2}\b/)?.[0]) || now.getFullYear()) - founded <= MAX_VENTURE_AGE);
    if (bundle.funding.length < before) console.log(`[entity-type] "${bundle.company.name}": founded ${founded}, dropped ${before - bundle.funding.length} venture round(s) too late to be its own`);
  }
  // Owned by a trust, a nonprofit or its employees: it takes no investor
  // rounds, so any found are someone else's (launch fix 78: Patagonia).
  if (bundle.ownership && NON_INVESTOR_OWNER.test(bundle.ownership)) {
    const before = bundle.funding.length;
    bundle.funding = bundle.funding.filter((f) => /^Form D:/.test(f.round ?? ""));
    if (bundle.funding.length < before) console.log(`[entity-type] "${bundle.company.name}": ${bundle.ownership}, dropped ${before - bundle.funding.length} round(s)`);
  }
  const type = entityTypeOf({ company: bundle.company, sec: bundle.secFilings, nonprofit: bundle.nonprofitFinancials, franchisor, funding: bundle.funding });
  bundle.company.entityType = type;
  const tag = (match: (url: string) => boolean) => {
    for (const s of bundle.sources) if (match(s.url) && !s.usedFor.includes("funding")) s.usedFor.push("funding");
  };
  if (type === "nonprofit") {
    if (bundle.funding.length) console.log(`[entity-type] "${bundle.company.name}": nonprofit, dropped ${bundle.funding.length} funding round(s)`);
    bundle.funding = [];
    bundle.sources = bundle.sources.filter((s) => !(s.usedFor.length === 1 && s.usedFor[0] === "funding"));
    const np = bundle.nonprofitFinancials;
    if (np) tag((u) => u === np.url);
  } else if (type === "public") {
    tag((u) => u.includes("/api/xbrl/companyfacts/"));
    // A company filing its own 10-K isn't anyone's subsidiary; that note is
    // from before it listed (launch fix 77: Limbach and its 2016 SPAC, 1347 Capital).
    if (bundle.ownership && /\b(subsidiary|wholly[- ]owned|division of)\b/i.test(bundle.ownership)) {
      console.log(`[entity-type] "${bundle.company.name}": public, dropped ownership note "${bundle.ownership}"`);
      bundle.ownership = undefined;
    }
  }
}

export function applySecFilings(bundle: ResearchBundle, sec: SecFilings): void {
  const c = bundle.company;
  // The year the 10-K states over one read off the site (launch fix 77:
  // Graybar showed 1864; its 10-K says 1869).
  const filedYear = sec.founded?.match(/\b(1[789]|20)\d{2}\b/)?.[0];
  if (filedYear && c.founded !== filedYear) {
    if (c.founded) console.log(`[sec] "${c.name}": founded ${c.founded} replaced by the 10-K's ${filedYear}`);
    c.founded = filedYear;
    c.foundedSource = sec.tenKUrl;
  } else if (!c.founded && sec.incorporatedYear) {
    c.founded = sec.incorporatedYear;
    c.foundedSource = sec.tenKUrl;
  }
  if (sec.incorporatedYear || sec.stateOfIncorporation) {
    c.incorporated = [sec.incorporatedYear, sec.stateOfIncorporation].filter(Boolean).join(", ");
  }
  if (!c.headquarters && sec.businessAddress) c.headquarters = sec.businessAddress;
  for (const o of sec.executiveOfficers) {
    const key = personKey(o.name);
    const known = bundle.leadership.find((l) => personKey(l.name) === key);
    if (known) {
      // The 10-K's title is the current one, as filed.
      if (sec.tenKUrl) { known.title = o.title; known.sourceUrl = sec.tenKUrl; known.asOf = sec.tenKDate; }
    } else if (sec.tenKUrl) {
      bundle.leadership.push({ name: o.name, title: o.title, sourceUrl: sec.tenKUrl, asOf: sec.tenKDate });
    }
  }
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www[.]/, "");
  } catch {
    return undefined;
  }
}
