import { REPORT_DISCLAIMER } from "../../lib/disclaimer.js";
import { pushProvenanceSection } from "../../lib/provenance/render.js";
import { pushCoverageSection } from "../../lib/coverage/render.js";
import { pushPostureSection } from "../domain-posture-agent/render.js";
import { pushRelatedSection } from "../related-entities-agent/render.js";
import { CreatorResearchBundle, PersonResearchBundle, PoliticalResearchBundle, ProductResearchBundle, ResearchBundle, Source } from "../../types/research.js";
import type { Form4Entry } from "../../types/research.js";
import { saleValue } from "../../lib/insiders.js";

/**
 * Report Agent
 * Turns a structured ResearchBundle into the Sprint 1 markdown report.
 * Sections present in spec but with no data yet (Risks, Opportunities —
 * those need analytical synthesis, slated for a later sprint) are
 * included as placeholders so the report shape is stable from day one.
 */
export class ReportAgent {
  /**
   * Task 3.3 — per-section citations, replacing the single flat "## Sources"
   * list every report type used to end with. Source.usedFor already tags
   * each source with the section(s) it supports (see src/types/research.ts
   * and every agent's own `sources.push({..., usedFor: [...]})` calls) and
   * the orchestrator already preserves that tag when it flattens each
   * agent's sources into bundle.sources — so this is purely a rendering
   * change, not a data-model one. A section with zero matching sources
   * renders "Unverified" rather than silently having no citation at all,
   * which is what the flat end-of-report list let happen for e.g. Risks/
   * Opportunities (LLM-synthesized commentary, never actually sourced).
   *
   * Launch fix (Oct 22): a section is never shown "Unverified". With no
   * source, a section that states anything is dropped whole; one that only
   * says nothing was found (an italic "_..._" line) stays, with no badge.
   */
  /** @param cited URLs the section's own items link to: they count as its sources too. */
  private pushSectionSources(lines: string[], sources: Source[], tags: string[], cited: (string | undefined)[] = []) {
    const seen = new Set<string>();
    const matched = sources.filter((s) => {
      if (!s.usedFor.some((u) => tags.includes(u)) || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
    // An item that links its own source keeps the section, even when the
    // tagged pages were dropped (round 13: ACCO's Leadership vanished while
    // the summary still named Darway).
    for (const url of cited) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      matched.push(sources.find((s) => s.url === url) ?? { url, title: hostLabel(url), retrievedAt: "", usedFor: tags });
    }
    if (matched.length === 0) {
      dropUnsourcedSection(lines);
    } else {
      lines.push(`**Sources:**`);
      matched.forEach((s, i) => {
        lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
      });
    }
    lines.push(``);
  }

  /** Last section of every report type: the consumer-report disclaimer. */
  private pushFooter(lines: string[]) {
    lines.push(`## Disclaimer`);
    lines.push(REPORT_DISCLAIMER);
    lines.push(``);
  }

  generate(bundle: ResearchBundle): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.company.name} — Research Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(``);

    // Closed status leads the report (Fix 4); ReportViewer shows the
    // Status section as a banner under the title.
    const closure = bundle.company.closure;
    const status: string[] = [];
    if (closure) {
      // How sure the report is depends on how many sites say so (round 2, Fix 5).
      const strength = closure.sources >= 2
        ? `${closure.sources} sources say this business has closed`
        : closure.communityOnly
          ? `Reported closed in a community post; not otherwise confirmed`
          : `Reported closed by one source; not otherwise confirmed`;
      status.push(`**Closed.** ${strength}: "${closure.evidence}" ([source](${closure.url}))`);
    }
    // A critical check that failed after its retry is said up top, not
    // only in a coverage row (launch fix 11).
    if (bundle.sanctionsUnavailable) {
      status.push(`**Sanctions screening didn't run.** The Consolidated Screening List couldn't be reached after a retry, so this report is not a clean result. [Check it by hand](https://www.trade.gov/consolidated-screening-list).`);
    }
    if (status.length) {
      lines.push(`## Status`);
      lines.push(...status);
      lines.push(``);
    }

    lines.push(`## Executive Summary`);
    if (bundle.company.siteUnreadable && bundle.company.thin) {
      // Website-first (round 2, Fix 1): never a name-only report instead.
      lines.push(`_Couldn't read this website: ${bundle.company.siteUnreadable}. Metis matches a business to the website you give it, so it didn't fall back to searching the name alone. Check the address, or add the city instead, and run it again._`);
    } else if (bundle.company.thin) {
      // Honest thin report (Fix 1): never trade up to a namesake.
      lines.push(`_Little public presence. Metis couldn't tie a website or other public pages to this business, so this report covers only public records that match the name.${bundle.company.anchor?.unlisted ? " Other companies share this name; they're not included." : ""} Add the city or website and run it again for more._`);
    } else {
      // Matched through the business listing when the site couldn't be read:
      // the summary states the business, never the fetch error (round 15:
      // Crumbl's summary opened "Couldn't read this website").
      lines.push(
        bundle.company.summary ?? bundle.company.description
          ? `${bundle.company.brandLevel ? `Brand-level: this describes ${bundle.company.name} overall, not the ${bundle.company.anchor?.location} location. ` : ""}${bundle.company.summary ?? bundle.company.description}`
          : `_No summary data found for ${bundle.company.name}. Try refining the company name or check network/source access._`
      );
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["overview"]);
    pushCoverageSection(lines, bundle.coverage);

    lines.push(`## Company Overview`);
    const anchor = bundle.company.anchor;
    if (anchor?.location || anchor?.website) lines.push(`- **Matched on:** ${[anchor.location, anchor.website].filter(Boolean).join(" · ")} (from your search)`);
    if (bundle.company.brandLevel) lines.push(`- **Location:** ${anchor?.location} — ${bundle.company.franchise ? "franchise location" : "a location"} of ${bundle.company.name}`);
    lines.push(`- **Website:** ${bundle.company.website ?? "Unknown"}`);
    if (bundle.company.siteVia === "archived") lines.push(`_The site blocks automated reading, so it was read from its latest Internet Archive copy._`);
    if (bundle.company.address) lines.push(`- **Address:** ${bundle.company.address}`);
    if (bundle.company.phone) lines.push(`- **Phone:** ${bundle.company.phone}`);
    if (bundle.company.hours) lines.push(`- **Hours:** ${bundle.company.hours}`);
    if (bundle.company.listing) lines.push(`- **Business listing:** [${bundle.company.listing.title}${bundle.company.listing.address ? `, ${bundle.company.listing.address}` : ""}](${bundle.company.listing.url})`);
    lines.push(`- **Founded:** ${bundle.company.founded ?? "Unknown"}${bundle.company.foundedSource ? ` ([${foundedLabel(bundle.company.foundedSource)}](${bundle.company.foundedSource}))` : ""}`);
    lines.push(
      `- **Headquarters:** ${bundle.company.headquarters
        ? `${bundle.company.headquarters}${bundle.company.headquartersUnverified ? " (location from your search, not verified)" : ""}`
        : "Unknown"}`
    );
    if (bundle.company.incorporated) lines.push(`- **Incorporated:** ${bundle.company.incorporated}`);
    // Sources that disagree on the HQ are both shown (launch fix 69: MJW's
    // listing said 12100 Wilshire Blvd, LinkedIn said Santa Monica).
    const listedCity = bundle.company.listing?.address?.match(/,\s*([A-Za-z .'-]+),\s*[A-Z]{2}\b/)?.[1]?.trim();
    const hqCity = bundle.company.headquarters?.split(",")[0]?.trim();
    if (listedCity && hqCity && listedCity.toLowerCase() !== hqCity.toLowerCase()) {
      lines.push(`- _Sources disagree on the headquarters: the business listing gives ${bundle.company.listing!.address}; other sources give ${bundle.company.headquarters}._`);
    }
    if (bundle.company.legalName && bundle.company.legalName !== bundle.company.name) lines.push(`- **Legal name:** ${bundle.company.legalName} (from its site)`);
    lines.push(`- **Industry:** ${bundle.company.industry ?? "Unknown"}`);
    if (bundle.company.locations?.length) lines.push(`- **Locations:** ${bundle.company.locations.join(" · ")}`);
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["overview"]);

    lines.push(`## Leadership`);
    if (bundle.leadership.length === 0) {
      lines.push(`_No leadership data collected in this pass._`);
    } else {
      if (bundle.company.brandLevel) lines.push(`_Brand-level: leadership of ${bundle.company.name}, not the location._`);
      for (const l of bundle.leadership) {
        // Directory-only names and titles a newer source gives someone else
        // are labeled, not hidden (launch fixes 7 and 9).
        const notes = [
          l.outdatedTitles?.length ? `also listed as ${l.outdatedTitles.join(", ")} by an older source; a newer one names someone else` : "",
          l.disputedTitles?.length ? `also called ${l.disputedTitles.join(", ")} by one source; better sources name someone else` : "",
          l.lowConfidence ? "low confidence: only a people directory lists this" : "",
        ].filter(Boolean);
        lines.push(`- **${l.name}** — ${l.title}${l.bio ? `: ${l.bio}` : ""}${notes.length ? ` _(${notes.join("; ")})_` : ""}${l.sourceUrl ? ` ([source](${l.sourceUrl}))` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["leadership"], bundle.leadership.map((l) => l.sourceUrl));

    // Investment and holding firms don't sell products (round 2, Fix 5).
    const firmLike = /\b(invest\w*|holding\w*|capital|equity|ventures?|partners|fund|asset management)\b/i
      .test(`${bundle.company.name} ${bundle.company.industry ?? ""}`);
    lines.push(firmLike ? `## Services / focus areas` : `## Products`);
    if (bundle.products.length === 0) {
      lines.push(`_No products or services listed._`);
    } else {
      if (bundle.company.brandLevel) lines.push(`_Brand-level: products of ${bundle.company.name} overall._`);
      for (const p of bundle.products) {
        lines.push(
          `- **${p.name}**${p.category ? ` (${p.category})` : ""}${
            p.description ? ` — ${p.description}` : ""
          }${p.sourceUrl ? ` ([source](${p.sourceUrl}))` : ""}`
        );
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["products"]);

    // Competitors and Risks/Opportunities moved here (right after Products,
    // before Funding/News) per the 7/17 weekend list — previously these
    // sat after Recent News, well below where a reader would expect the
    // competitive/strategic picture relative to the product overview.
    lines.push(`## Competitors`);
    if (bundle.competitors.length === 0) {
      lines.push(`_No competitors identified in this pass._`);
    } else {
      for (const c of bundle.competitors) {
        lines.push(
          `- **${c.name}**${c.note ? ` _(${c.note})_` : ""}`
        );
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["competitors"]);

    // Risks/Opportunities cite the facts they rest on (synthesis-agent);
    // an item with no cited source never reaches the bundle, and a section
    // left with no source is dropped (pushSectionSources).
    lines.push(`## Risks`);
    if (bundle.risks && bundle.risks.length > 0) {
      // Each item links to the record it rests on (launch fix 72).
      for (const risk of bundle.risks) lines.push(`- ${risk}${citeLink(bundle.synthesisCitations?.[risk])}`);
    } else if (bundle.risks) {
      // The analysis ran and found nothing real (launch fix 78: MJW's top
      // risk was filler restating its opportunity).
      lines.push(`_No material risks found in the records reviewed._`);
    } else {
      lines.push(`_Insufficient data for risk analysis on this run._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["risks"]);

    lines.push(`## Opportunities`);
    if (bundle.opportunities && bundle.opportunities.length > 0) {
      for (const opp of bundle.opportunities) lines.push(`- ${opp}${citeLink(bundle.synthesisCitations?.[opp])}`);
    } else {
      lines.push(`_Insufficient data for opportunity analysis on this run._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["opportunities"]);

    this.pushFundingSection(lines, bundle);

    if (bundle.corporateActions?.length) {
      lines.push(`## Corporate Actions`);
      for (const a of bundle.corporateActions) lines.push(`- ${a.kind}: ${a.name}${a.date ? ` (${a.date})` : ""} ([source](${a.url}))`);
      lines.push(``);
    }

    this.pushSecSection(lines, bundle);
    this.pushFddSection(lines, bundle);

    if (bundle.federalSpending && bundle.federalSpending.length > 0) {
      lines.push(`## Federal Spending`);
      for (const c of bundle.contractCeilings ?? []) {
        lines.push(`- **${c.agency}: ${money(c.ceiling)} ceiling announced; about ${money(c.obligated)} obligated to date.**${c.newsUrl ? ` ([announcement](${c.newsUrl}))` : ""}`);
      }
      for (const f of bundle.federalSpending) {
        lines.push(
          `- **${f.amount ?? "Undisclosed"}**${f.awardType ? ` (${f.awardType})` : ""} — ${
            f.awardingAgency ?? "Unknown agency"
          }${f.date ? ` (${f.date})` : ""}${f.description ? `: ${f.description}` : ""}`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["federal-spending"]);
    }

    if (bundle.insiderActivity && bundle.insiderActivity.length > 0) {
      lines.push(`## Insider Activity`);
      for (const f of bundle.insiderActivity) {
        lines.push(
          `- **${f.filerName}**${f.relationship ? ` (${f.relationship})` : ""} — ${
            f.transactionType ?? "Filing"
          }${f.shares ? ` · ${f.shares} shares` : ""}${f.value ? ` · ${f.value}` : ""}${
            // Shares times a per-share price (launch fix 84: totals were missing).
            totalOf(f) ? ` · about ${money(totalOf(f)!)} total` : ""
          }${f.date ? ` (${f.date})` : ""}${f.filingUrl ? ` ([filing](${f.filingUrl}))` : ""}`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["insider-activity"]);
    }

    lines.push(`## Recent News`);
    // An undated item can't claim to be recent, so it's left out here.
    const datedNews = bundle.news.filter((n) => n.date);
    if (datedNews.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      // headline · outlet · date, as a link. ReportViewer renders the
      // part after " — " as the card's subline.
      for (const n of datedNews) {
        const meta = [n.outlet, n.date, n.solicitation ? "law-firm solicitation, not a filed lawsuit" : ""].filter(Boolean).join(" · ");
        lines.push(`- [${n.headline}](${n.url ?? "#"})${meta ? ` — ${meta}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["news"]);

    // Public Records already cites its own source inline per item (every
    // bullet is itself a link) — it doesn't suffer from the flat-list
    // problem this task is fixing, so it's left as-is rather than also
    // getting a redundant Sources sub-list.
    this.pushPublicRecordsSection(lines, bundle);
    this.pushCourtRecordsSection(lines, bundle);
    pushRelatedSection(lines, bundle.relatedEntities);
    pushPostureSection(lines, bundle.domainPosture);
    pushProvenanceSection(lines, bundle.provenance);

    this.pushFooter(lines);
    return lines.join("\n");
  }

  /**
   * 7/20 public-record fusion sources (sanctions screening, Wayback
   * archive history, ProPublica nonprofit lookup, LittleSis power-
   * mapping) — shared between company and person
   * reports since every source but Wayback applies to both. Renders
   * nothing at all when none of the fields are present, so Basic/Free
   * reports (which never populate these) don't show an empty section.

   */
  private pushPublicRecordsSection(
    lines: string[],
    bundle: Pick<ResearchBundle, "sanctionsMatches" | "sanctionsUnavailable" | "webArchive" | "nonprofitFilings" | "powerMapConnections"> & Partial<Pick<ResearchBundle, "domainPosture" | "sanctionsScreened" | "sanctionsRuledOut">>
  ) {
    const hasAny =
      bundle.sanctionsUnavailable || bundle.sanctionsScreened ||
      (bundle.sanctionsMatches && bundle.sanctionsMatches.length > 0) ||
      bundle.webArchive ||
      (bundle.nonprofitFilings && bundle.nonprofitFilings.length > 0) ||
      (bundle.powerMapConnections && bundle.powerMapConnections.length > 0);
    if (!hasAny) return;

    lines.push(`## Public Records`);

    if (bundle.sanctionsUnavailable) {
      lines.push(`**Sanctions Screening:** Screening unavailable. The Consolidated Screening List couldn't be checked on this run, so this is not a clean result. [Check it by hand](https://www.trade.gov/consolidated-screening-list).`);
      lines.push(``);
    }

    if (bundle.sanctionsScreened && !bundle.sanctionsMatches?.length) {
      // Similar names are never listed (launch fix 40): only counted.
      const ruled = bundle.sanctionsRuledOut ? ` ${bundle.sanctionsRuledOut} similar name${bundle.sanctionsRuledOut === 1 ? "" : "s"} on the lists ${bundle.sanctionsRuledOut === 1 ? "was" : "were"} checked and ruled out (different name or country).` : "";
      lines.push(`**Sanctions Screening:** No matches on the Consolidated Screening List (OFAC SDN, Entity List and nine other US lists).${ruled}`);
      lines.push(``);
    }

    if (bundle.sanctionsMatches && bundle.sanctionsMatches.length > 0) {
      lines.push(`**Sanctions Screening** _(name and country match this subject — confirm identity before acting)_`);
      for (const m of bundle.sanctionsMatches) {
        lines.push(`- **${m.name}** — ${m.source}${m.type ? ` (${m.type})` : ""}${m.programs?.length ? ` · ${m.programs.join(", ")}` : ""}`);
      }
      lines.push(``);
    }

    if (bundle.webArchive) {
      lines.push(`**Web Archive History**`);
      if (bundle.webArchive.firstSnapshot) lines.push(`- First archived: [${bundle.webArchive.firstSnapshot.timestamp}](${bundle.webArchive.firstSnapshot.url})`);
      // Snapshots from before the current registration are a previous
      // owner's site (launch fix 32: Gecko archived from 2001, registered 2013).
      const registered = bundle.domainPosture?.registeredAt;
      const first = bundle.webArchive.firstSnapshot?.timestamp;
      if (registered && first && first.slice(0, 8) < registered.slice(0, 10).replace(/-/g, "")) {
        lines.push(`- The domain was registered on ${registered.slice(0, 10)}; snapshots before that date likely belong to a previous owner.`);
      }
      if (bundle.webArchive.latestSnapshot) lines.push(`- Most recent snapshot: [${bundle.webArchive.latestSnapshot.timestamp}](${bundle.webArchive.latestSnapshot.url})`);
      if (bundle.webArchive.snapshotCount) lines.push(`- ${bundle.webArchive.snapshotCount} snapshot(s) on record`);
      lines.push(``);
    }

    if (bundle.nonprofitFilings && bundle.nonprofitFilings.length > 0) {
      lines.push(`**Nonprofit Filings (990s)**`);
      for (const n of bundle.nonprofitFilings) {
        lines.push(`- [${n.name}](${n.url})${n.ntee ? ` — ${n.ntee}` : ""} (EIN ${n.ein})`);
      }
      lines.push(``);
    }

    if (bundle.powerMapConnections && bundle.powerMapConnections.length > 0) {
      lines.push(`**Power-Map Connections** _(LittleSis)_`);
      for (const p of bundle.powerMapConnections) {
        lines.push(`- [${p.name}](${p.url})${p.entityKind ? ` (${p.entityKind})` : ""}${p.blurb ? ` — ${p.blurb}` : ""}`);
      }
      lines.push(``);
    }

  }

  /** Parsed SEC filings (launch fix 19): financials by fiscal year, then
   *  what the latest 10-K and proxy state. Nothing for a non-filer. */
  /**
   * Funding by entity type (launch fix 34): a nonprofit shows its 990
   * contributions and federal grants, never rounds; a public company its
   * filed financials; everyone else the rounds on record.
   */
  private pushFundingSection(lines: string[], bundle: ResearchBundle) {
    const type = bundle.company.entityType;
    lines.push(`## Funding`);
    if (bundle.ownership) {
      lines.push(`**Ownership:** ${bundle.ownership}`);
      lines.push(``);
    }
    if (type === "nonprofit") {
      const np = bundle.nonprofitFinancials;
      lines.push(`_Nonprofit: funded by contributions, grants and program revenue, not investors._`);
      for (const y of np?.years ?? []) {
        const parts = [
          y.contributions !== undefined ? `contributions and grants ${money(y.contributions)}` : "",
          y.revenue !== undefined ? `total revenue ${money(y.revenue)}` : "",
          y.expenses !== undefined ? `expenses ${money(y.expenses)}` : "",
          y.assets !== undefined ? `assets ${money(y.assets)}` : "",
        ].filter(Boolean);
        if (parts.length) lines.push(`- **${y.year} Form ${y.formType ?? "990"}:** ${parts.join(" · ")}${y.pdfUrl ? ` ([filing](${y.pdfUrl}))` : ""}`);
      }
      const grants = (bundle.federalSpending ?? []).filter((f) => /grant|assistance|cooperative/i.test(f.awardType ?? ""));
      if (grants.length) {
        const agencies = [...new Set(grants.map((g) => g.awardingAgency).filter(Boolean))];
        lines.push(`- **Federal grants:** ${grants.length} on record${agencies.length ? ` (${agencies.slice(0, 4).join(", ")})` : ""}; see Federal Spending.`);
      }
      if (!np?.years.length && !grants.length) lines.push(`_No 990 figures or federal grants found._`);
    } else if (type === "public") {
      const y = bundle.secFilings?.financials[0];
      lines.push(`_Public company: financing and capital structure are in its SEC filings._`);
      if (y) {
        const parts = [y.revenue !== undefined ? `revenue ${money(y.revenue)}` : "", y.netIncome !== undefined ? `net income ${money(y.netIncome)}` : ""].filter(Boolean);
        if (parts.length) lines.push(`- **FY${y.year}:** ${parts.join(" · ")} (see SEC Filings)`);
      }
      for (const f of bundle.funding) lines.push(fundingLine(f));
    } else if (bundle.funding.length === 0) {
      lines.push(`_No public funding records found._`);
    } else {
      for (const f of bundle.funding) lines.push(fundingLine(f));
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["funding"]);
  }

  private pushSecSection(lines: string[], bundle: ResearchBundle) {
    const sec = bundle.secFilings;
    if (!sec) return;
    const body: string[] = [];
    for (const y of sec.financials) {
      const parts = [
        y.revenue !== undefined ? `revenue ${money(y.revenue)}` : "",
        y.netIncome !== undefined ? `net income ${money(y.netIncome)}` : "",
        y.grossMargin !== undefined ? `gross margin ${(y.grossMargin * 100).toFixed(1)}%` : "",
      ].filter(Boolean);
      if (parts.length) body.push(`- **FY${y.year}:** ${parts.join(" · ")}`);
    }
    const q = sec.latestQuarter;
    if (q) {
      const pct = (v?: number) => (v !== undefined ? `${(v * 100).toFixed(1)}%` : undefined);
      const parts = [
        q.revenue !== undefined ? `revenue ${money(q.revenue)}${q.priorRevenue !== undefined ? ` (vs ${money(q.priorRevenue)} a year earlier)` : ""}` : "",
        q.grossMargin !== undefined ? `gross margin ${pct(q.grossMargin)}${q.priorGrossMargin !== undefined ? ` (vs ${pct(q.priorGrossMargin)})` : ""}` : "",
      ].filter(Boolean);
      if (parts.length) body.push(`- **${q.label}:** ${parts.join(" · ")}`);
    }
    const e = sec.earnings;
    if (e) {
      body.push(`- **Latest results${e.period ? ` (${e.period})` : ""}, released ${e.date}:** ${e.highlights.join("; ") || "see release"} ([release](${e.url}))`);
      if (e.guidance) body.push(`- **Guidance:** ${e.guidance}`);
    }
    if (sec.description) body.push(`- **Business (10-K):** ${sec.description}`);
    if (sec.employees) body.push(`- **Employees:** ${sec.employees}`);
    if (sec.executiveOfficers.length) body.push(`- **Executive officers:** ${sec.executiveOfficers.map((o) => `${o.name} (${o.title})`).join("; ")}`);
    if (sec.board?.independence) body.push(`- **Board:** ${sec.board.independence}`);
    if (sec.legalProceedings) body.push(`- **Legal proceedings (10-K):** ${sec.legalProceedings}`);
    if (sec.riskFactors.length) {
      body.push(`- **Risk factors (10-K):**`);
      for (const r of sec.riskFactors) body.push(`  - ${r}`);
    }
    if (body.length === 0) return;
    lines.push(`## SEC Filings`);
    lines.push(`_${sec.name}${sec.tenKDate ? `, from the 10-K filed ${sec.tenKDate}` : ""}${sec.financials.length ? " and its XBRL financial data" : ""}._`);
    lines.push(...body);
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["sec-filings"]);
  }

  /** FDD figures as published (launch fix 29), each linked to its page. */
  private pushFddSection(lines: string[], bundle: ResearchBundle) {
    const f = bundle.fdd;
    if (!f) return;
    const rows: [string, string | undefined][] = [
      ["Franchisor revenue", f.franchisorRevenue], ["Franchisor net income", f.franchisorNetIncome],
      ["Average store sales", f.averageUnitSales], ["Stores", f.unitCount], ["Franchise fee", f.franchiseFee],
      ["Royalty", f.royalty], ["Initial investment", f.initialInvestment],
    ];
    lines.push(`## Franchise Disclosure`);
    lines.push(`_Figures from ${f.year ? `the ${f.year} ` : "its "}Franchise Disclosure Document, as quoted by the pages cited._`);
    for (const [label, v] of rows) if (v) lines.push(`- **${label}:** ${v}`);
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["fdd"]);
  }

  /** Court dockets, NLRB cases and NPI registrations (launch fixes 12-14),
   *  each linked to its record. Nothing when none were found. */
  private pushCourtRecordsSection(lines: string[], bundle: ResearchBundle) {
    if (!bundle.courtCases?.length && !bundle.npiRecords?.length) return;
    lines.push(`## Court and Agency Records`);
    for (const c of bundle.courtCases ?? []) {
      const side = c.role === "defendant" ? "against the company" : c.role === "plaintiff" ? "brought by the company"
        : c.role === "debtor" ? "company is the debtor" : c.role === "charged" ? "charge against the company" : "";
      const meta = [c.court, c.docketNumber, c.filed ? `filed ${c.filed}` : "", side, c.caseType, c.status, c.routine ? "routine bankruptcy matter" : ""]
        .filter(Boolean).join(" · ");
      lines.push(`- [${c.caption}](${c.url})${meta ? ` — ${meta}` : ""}`);
    }
    for (const r of bundle.npiRecords ?? []) {
      const meta = [r.taxonomy, r.location, r.official ? `authorized official ${r.official}` : "", r.enumerated ? `registered ${r.enumerated}` : ""].filter(Boolean).join(" · ");
      lines.push(`- [NPI ${r.npi}: ${r.name}](${r.url})${meta ? ` — ${meta}` : ""}`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["court-records", "public-filings"]);
  }

  /**
   * Person research report. Mirrors generate() above but with a shape
   * suited to an individual: bio summary, current role, best-effort
   * career history, recent news. No Risks/Opportunities section —
   * that framing doesn't map cleanly onto a person.
   */
  generatePerson(bundle: PersonResearchBundle): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.person.name} — Person Research Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    // Affiliation typed alongside the name at search time (e.g. "csun"
    // in "Daniel Olmos csun") — shown here so it's clear why this
    // particular "Daniel Olmos" was researched among however many share
    // the name, without polluting the title/H1 itself.
    if (bundle.person.affiliation) {
      lines.push(`*Searched with affiliation: ${bundle.person.affiliation}*`);
    }
    lines.push(``);

    lines.push(`## About`);
    lines.push(
      bundle.person.summary
        ? bundle.person.summary
        : `_No summary data found for ${bundle.person.name}._`
    );
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["bio"]);
    pushCoverageSection(lines, bundle.coverage);

    // Quick facts row
    const facts: string[] = [];
    if (bundle.person.nationality) facts.push(`**Nationality:** ${bundle.person.nationality}`);
    if (bundle.person.education)   facts.push(`**Education:** ${bundle.person.education}`);
    if (bundle.person.netWorth)    facts.push(`**Net Worth:** ${bundle.person.netWorth}`);
    if (bundle.person.knownFor)    facts.push(`**Known For:** ${bundle.person.knownFor}`);
    if (facts.length > 0) {
      for (const f of facts) lines.push(`- ${f}`);
      lines.push(``);
    }

    lines.push(`## Current Role`);
    if (bundle.person.currentRole && bundle.person.currentCompany) {
      lines.push(`- **Role:** ${bundle.person.currentRole}`);
      lines.push(`- **Company:** ${bundle.person.currentCompany}`);
    } else if (bundle.person.currentRole) {
      lines.push(`- **Role:** ${bundle.person.currentRole}`);
    } else {
      lines.push(`_No current role data collected in this pass._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["bio", "background"]);

    lines.push(`## Career History`);
    if (bundle.careerHistory.length === 0) {
      lines.push(`_No career history collected in this pass._`);
    } else {
      for (const c of bundle.careerHistory) {
        lines.push(`- ${c.title}${c.company ? ` at ${c.company}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["bio", "background"]);

    // Charon Person Research (Round 3) — only present on deep/internal-tier
    // runs, so this section is omitted entirely rather than shown empty
    // for everyone else.
    if (bundle.corporateAffiliations && bundle.corporateAffiliations.length > 0) {
      lines.push(`## Corporate Affiliations`);
      for (const a of bundle.corporateAffiliations) {
        const meta = [a.jurisdiction, a.startDate ? `since ${a.startDate}` : null, a.endDate ? `until ${a.endDate}` : null]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `- ${a.companyUrl ? `[**${a.companyName}**](${a.companyUrl})` : `**${a.companyName}**`}${
            a.position ? ` — ${a.position}` : ""
          }${meta ? ` _(${meta})_` : ""}`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["corporate-affiliations"]);
    }

    if (bundle.foiaRequests && bundle.foiaRequests.length > 0) {
      lines.push(`## FOIA Requests`);
      for (const f of bundle.foiaRequests) {
        lines.push(
          `- [${f.title}](${f.url})${f.status ? ` — ${f.status}` : ""}${f.agency ? ` (${f.agency})` : ""}`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["foia-requests"]);
    }

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      // headline · outlet · date, as a link. ReportViewer renders the
      // part after " — " as the card's subline.
      for (const n of bundle.news) {
        const meta = [n.outlet, n.date, n.solicitation ? "law-firm solicitation, not a filed lawsuit" : ""].filter(Boolean).join(" · ");
        lines.push(`- [${n.headline}](${n.url ?? "#"})${meta ? ` — ${meta}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["news"]);

    this.pushPublicRecordsSection(lines, bundle);
    pushProvenanceSection(lines, bundle.provenance);

    this.pushFooter(lines);
    return lines.join("\n");
  }

  generateProduct(bundle: ProductResearchBundle): string {
    const lines: string[] = [];
    lines.push(`# ${bundle.product.name} — Product Research Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(``);

    lines.push(`## Overview`);
    lines.push(bundle.product.description ?? `_No description collected._`);
    lines.push(``);
    // product-agent tags each source with the sections its search fed
    // (overview, product-details, specs, competitors, news).
    this.pushSectionSources(lines, bundle.sources, ["overview"]);

    lines.push(`## Product Details`);
    lines.push(`- **Brand / Manufacturer:** ${bundle.product.brand ?? "Unknown"}`);
    lines.push(`- **Category:** ${bundle.product.category ?? "Unknown"}`);
    lines.push(`- **Price:** ${bundle.product.price ?? "Unknown"}`);
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["product-details"]);

    lines.push(`## Specs`);
    if (bundle.specs.length === 0) {
      lines.push(`_No specs collected._`);
    } else {
      for (const s of bundle.specs) {
        lines.push(`- **${s.label}:** ${s.value}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["specs"]);

    lines.push(`## Competing Products`);
    if (bundle.competitors.length === 0) {
      lines.push(`_No competing products identified._`);
    } else {
      for (const c of bundle.competitors) {
        lines.push(`- **${c.name}**${c.note ? ` — ${c.note}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["competitors"]);

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(`- [${n.headline}](${n.url ?? "#"})${n.summary ? ` — ${n.summary}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["news"]);

    // Pros/Cons/Verdict are LLM-synthesized across the whole bundle, not
    // their own sourced section — correctly render "Unverified" below.
    lines.push(`## Pros`);
    if (bundle.pros && bundle.pros.length > 0) {
      for (const p of bundle.pros) lines.push(`- ${p}`);
    } else {
      lines.push(`_Insufficient review data for this run._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["pros-cons"]);

    lines.push(`## Cons`);
    if (bundle.cons && bundle.cons.length > 0) {
      for (const c of bundle.cons) lines.push(`- ${c}`);
    } else {
      lines.push(`_Insufficient review data for this run._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["pros-cons"]);

    lines.push(`## Verdict`);
    if (bundle.verdict) {
      lines.push(bundle.verdict);
    } else {
      lines.push(`_Insufficient data for a verdict on this run._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["verdict"]);

    this.pushFooter(lines);
    return lines.join("\n");
  }

  /**
   * Political research report (Round 2, item 1). Nonpartisan framing
   * throughout — this compiles what's publicly reported, it doesn't
   * take a position.
   */
  generatePolitical(bundle: PoliticalResearchBundle): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.profile.name} — Political Research Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(``);

    if (bundle.profile.nameMismatchWarning) {
      lines.push(`> ⚠️ **Name not confirmed:** ${bundle.profile.nameMismatchWarning} Profile and opposition-research data below reflects only what real API integrations (Congress.gov, OpenFEC, LegiScan) could independently verify — nothing was synthesized from search results under this name. Double-check the spelling and re-run.`);
      lines.push(``);
    } else if (bundle.profile.dataUnavailable) {
      lines.push(`> ℹ️ **Limited public data available:** No source — search synthesis, Congress.gov, OpenFEC, LegiScan, or the statewide-executives table — could confirm this person's current office, party, or state. This likely means they don't currently hold elected office, hold a role outside what these sources cover (e.g. a local or appointed position), or simply have a limited public footprint. Anything below is best-effort context, not a verified profile.`);
      lines.push(``);
    }

    lines.push(`## Executive Summary`);
    lines.push(
      bundle.profile.summary
        ? bundle.profile.summary
        : `_No summary data found for ${bundle.profile.name}._`
    );
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["profile"]);

    // Senators represent an entire state, not a numbered district — show
    // that plainly instead of "Unknown", which reads like missing data
    // rather than a structural fact about the office.
    const isSenate = /senat/i.test(bundle.profile.office ?? "");
    const districtDisplay = bundle.profile.district
      ? bundle.profile.district
      : isSenate ? "Statewide (Senate — no numbered district)" : "Unknown";

    lines.push(`## Profile`);
    lines.push(`- **Office:** ${bundle.profile.office ?? "Unknown"}`);
    lines.push(`- **Party:** ${bundle.profile.party ?? "Unknown"}`);
    lines.push(`- **State:** ${bundle.profile.state ?? "Unknown"}`);
    lines.push(`- **District:** ${districtDisplay}`);
    if (bundle.profile.education) lines.push(`- **Education:** ${bundle.profile.education}`);
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["profile"]);

    // District Makeup / Approval Rating / (roll-call) Voting Record /
    // Campaign Finance below are search-synthesized, not pulled from a
    // structured API — unlike Profile (Congress.gov) and Federal
    // Campaign Finance (OpenFEC) elsewhere in this report. Framed
    // explicitly as best-effort rather than left to read like a gap,
    // since coverage genuinely varies by how much public data exists
    // for a given office.
    lines.push(`## District Makeup`);
    if (bundle.districtMakeup && (bundle.districtMakeup.partisanLean || bundle.districtMakeup.demographics || bundle.districtMakeup.keyIssues)) {
      if (bundle.districtMakeup.partisanLean) lines.push(`- **Partisan Lean:** ${bundle.districtMakeup.partisanLean}`);
      if (bundle.districtMakeup.demographics) lines.push(`- **Demographics:** ${bundle.districtMakeup.demographics}`);
      if (bundle.districtMakeup.keyIssues)    lines.push(`- **Key Issues:** ${bundle.districtMakeup.keyIssues}`);
    } else if (isSenate) {
      lines.push(`_Senators represent their entire state — district-level partisan lean and demographics don't apply the way they do for House seats. See the state's own political profile for this kind of context._`);
    } else {
      lines.push(`_Best-effort from open sources — no specific district partisan-lean or demographic data surfaced for this pass. Not every district has this level of public detail readily available._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["district"]);

    lines.push(`## Approval Rating`);
    if (bundle.approvalRating?.value) {
      lines.push(
        `- **Rating:** ${bundle.approvalRating.value}${
          bundle.approvalRating.source ? ` _(${bundle.approvalRating.source}${bundle.approvalRating.asOf ? `, ${bundle.approvalRating.asOf}` : ""})_` : ""
        }`
      );
    } else {
      lines.push(`_Best-effort from open sources — most individual members of Congress don't have recent, publicly available polling to draw from. This section only populates when a specific poll surfaces._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["approval"]);

    lines.push(`## Voting Record`);
    if (bundle.votingRecord.length === 0) {
      lines.push(`_Best-effort from open sources — specific named votes only appear here when public coverage discusses them directly. See Sponsored Legislation below for a complete, API-verified list of bills this member has introduced._`);
    } else {
      for (const v of bundle.votingRecord) {
        lines.push(`- **${v.bill}** — ${v.position}${v.note ? `: ${v.note}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["voting-record"]);

    lines.push(`## Campaign Finance`);
    if (bundle.campaignFinance.length === 0) {
      lines.push(`_Best-effort from open sources — see Federal Campaign Finance below for verified FEC totals and donor breakdown._`);
    } else {
      for (const c of bundle.campaignFinance) {
        lines.push(
          `- ${c.cycle ? `**${c.cycle}:** ` : ""}${c.totalRaised ?? "Undisclosed"}${
            c.topDonorTypes ? ` — ${c.topDonorTypes}` : ""
          }${c.note ? ` (${c.note})` : ""}`
        );
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["campaign-finance"]);

    // Real FEC data (federal candidates only) — separate from the
    // search-synthesized Campaign Finance section above since this is
    // sourced directly from api.open.fec.gov, not LLM extraction.
    if (bundle.fecSummary || (bundle.fecDonorBreakdown && bundle.fecDonorBreakdown.length > 0)) {
      lines.push(`## Federal Campaign Finance (FEC)`);
      if (bundle.fecSummary) {
        const s = bundle.fecSummary;
        lines.push(`- **Cycle:** ${s.cycle ?? "Unknown"}`);
        lines.push(`- **Total Raised:** ${s.totalReceipts ?? "Unknown"}`);
        lines.push(`- **Total Spent:** ${s.totalDisbursements ?? "Unknown"}`);
        lines.push(`- **Cash on Hand:** ${s.cashOnHand ?? "Unknown"}`);
      }
      if (bundle.fecDonorBreakdown && bundle.fecDonorBreakdown.length > 0) {
        lines.push(``);
        lines.push(`**Top Donor Employers:**`);
        for (const d of bundle.fecDonorBreakdown) {
          lines.push(`- ${d.employer} — ${d.total}`);
        }
      }
      lines.push(``);
      // Real FEC data is tagged "campaign-finance" too, same as the
      // search-synthesized section above — both genuinely draw from that
      // tag, so they legitimately share the same Sources list here.
      this.pushSectionSources(lines, bundle.sources, ["campaign-finance"]);
    }

    if (bundle.sponsoredLegislation && bundle.sponsoredLegislation.length > 0) {
      lines.push(`## Sponsored Legislation`);
      for (const b of bundle.sponsoredLegislation) {
        const meta = [b.congress ? `${b.congress}th Congress` : null, b.introducedDate ? `introduced ${b.introducedDate}` : null]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `- ${b.url ? `[**${b.billId}**](${b.url})` : `**${b.billId}**`} — ${b.title}${meta ? ` _(${meta})_` : ""}${
            b.latestAction ? `\n  Latest action: ${b.latestAction}${b.latestActionDate ? ` (${b.latestActionDate})` : ""}` : ""
          }`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["voting-record"]);
    }

    if (bundle.foiaRequests && bundle.foiaRequests.length > 0) {
      lines.push(`## FOIA Requests`);
      for (const f of bundle.foiaRequests) {
        lines.push(
          `- [${f.title}](${f.url})${f.status ? ` — ${f.status}` : ""}${f.agency ? ` (${f.agency})` : ""}`
        );
      }
      lines.push(``);
      this.pushSectionSources(lines, bundle.sources, ["foia-requests"]);
    }

    lines.push(`## Opposition Research`);
    if (bundle.oppositionResearch.length === 0) {
      lines.push(`_No opposition research findings in this pass._`);
    } else {
      for (const o of bundle.oppositionResearch) {
        const severityTag = o.severity ? ` [${o.severity.toUpperCase()}]` : "";
        lines.push(`- **${o.topic}**${severityTag} — ${o.finding}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["opposition-research"]);

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(`- [${n.headline}](${n.url ?? "#"})${n.summary ? ` — ${n.summary}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["news"]);

    this.pushFooter(lines);
    return lines.join("\n");
  }

  /**
   * Creator / market-signal report (general v1). Trend and YouTube stats
   * are shown as best-effort/sourced-but-unverified where they came from
   * search synthesis, and as real numbers where they came from the
   * YouTube Data API — same "don't blur real data with a guess"
   * discipline as the political report's FEC vs. search-synthesis split.
   */
  generateCreator(bundle: CreatorResearchBundle): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.profile.name} — Creator / Market-Signal Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(``);

    lines.push(`## Profile`);
    lines.push(
      bundle.profile.summary
        ? bundle.profile.summary
        : `_No summary data found for ${bundle.profile.name}._`
    );
    lines.push(``);
    const facts: string[] = [];
    if (bundle.profile.handle) facts.push(`**Handle:** ${bundle.profile.handle}`);
    if (bundle.profile.platform) facts.push(`**Platform:** ${bundle.profile.platform}`);
    if (bundle.profile.category) facts.push(`**Category:** ${bundle.profile.category}`);
    if (bundle.profile.knownFor) facts.push(`**Known For:** ${bundle.profile.knownFor}`);
    if (facts.length > 0) {
      for (const f of facts) lines.push(`- ${f}`);
      lines.push(``);
    }
    this.pushSectionSources(lines, bundle.sources, ["profile"]);

    lines.push(`## YouTube Stats`);
    if (bundle.youtubeStats) {
      const s = bundle.youtubeStats;
      lines.push(`- **Channel:** [${s.channelTitle}](${s.url})`);
      lines.push(`- **Subscribers:** ${s.subscriberCount ?? "Hidden"}`);
      lines.push(`- **Total Views:** ${s.viewCount ?? "Unknown"}`);
      lines.push(`- **Videos:** ${s.videoCount ?? "Unknown"}`);
      if (s.publishedAt) lines.push(`- **Channel Created:** ${s.publishedAt.slice(0, 10)}`);
    } else {
      lines.push(`_No matching YouTube channel found, or YOUTUBE_API_KEY isn't configured._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["youtube-stats"]);

    lines.push(`## Interest Trend`);
    if (bundle.trend && bundle.trend.points.length > 0) {
      const t = bundle.trend;
      const directionLabel = t.direction === "rising" ? "Rising ↑" : t.direction === "falling" ? "Falling ↓" : "Flat →";
      lines.push(`- **Direction (last 3mo):** ${directionLabel}`);
      if (t.averageInterest !== undefined) lines.push(`- **Average Relative Interest:** ${t.averageInterest}/100`);
      lines.push(`_Google Trends search-interest index, 0-100 relative to the term's own peak — not a follower or view count._`);
    } else {
      lines.push(`_No Google Trends data available for this name — either search interest is too low to chart, or the lookup failed._`);
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["trend"]);

    lines.push(`## Short-Form Mentions (TikTok / Instagram)`);
    if (bundle.shortFormMentions.length === 0) {
      lines.push(`_No recent (past month) TikTok or Instagram mentions found via search. Neither platform has a reliable free API for follower/post data on an arbitrary account, so this is search-indexed mentions only, not a full scan of either platform — see docs/next-verticals-scoping.md._`);
    } else {
      const tiktok = bundle.shortFormMentions.filter((m) => m.platform === "tiktok");
      const instagram = bundle.shortFormMentions.filter((m) => m.platform === "instagram");
      if (tiktok.length > 0) {
        lines.push(`**TikTok:**`);
        for (const m of tiktok) lines.push(`- [${m.title}](${m.url})${m.snippet ? ` — ${m.snippet}` : ""}`);
      }
      if (instagram.length > 0) {
        lines.push(`**Instagram:**`);
        for (const m of instagram) lines.push(`- [${m.title}](${m.url})${m.snippet ? ` — ${m.snippet}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["short-form-mentions"]);

    lines.push(`## What People Are Saying`);
    if (bundle.signals.length === 0) {
      lines.push(`_No specific chatter, controversy, or sponsorship-reaction findings in this pass._`);
    } else {
      for (const s of bundle.signals) {
        const sentimentTag = s.sentiment ? ` [${s.sentiment.toUpperCase()}]` : "";
        lines.push(`- **${s.topic}**${sentimentTag} — ${s.finding}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["signals"]);

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(`- [${n.headline}](${n.url ?? "#"})${n.summary ? ` — ${n.summary}` : ""}`);
      }
    }
    lines.push(``);
    this.pushSectionSources(lines, bundle.sources, ["news"]);

    this.pushFooter(lines);
    return lines.join("\n");
  }
}

/**
 * Removes the section just written (from its "## " heading on) when its
 * body states anything: with no source behind it, it doesn't ship. A body
 * of only notices ("_No competitors identified..._", "Founded: Unknown")
 * says nothing about the subject and stays.
 */
/** $12,880,000,000 -> "$12.88B". */
function citeLink(urls: string[] | undefined): string {
  return urls?.length ? ` (${urls.slice(0, 2).map((u, i) => `[source${urls.length > 1 ? ` ${i + 1}` : ""}](${u})`).join(", ")})` : "";
}

function fundingLine(f: { round?: string; amount?: string; date?: string; investors?: string[]; url?: string }): string {
  return `- ${f.round ?? "Round"}: ${f.amount ?? "Undisclosed"}${f.date ? ` (${f.date})` : ""}${f.investors?.length ? ` — ${f.investors.join(", ")}` : ""}${f.url ? ` ([filing](${f.url}))` : ""}`;
}

export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  // Two decimals, trailing zeros off: $46.95M, $646.8M, $125M.
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

export function dropUnsourcedSection(lines: string[]): void {
  let start = lines.length - 1;
  while (start >= 0 && !lines[start].startsWith("## ")) start--;
  if (start < 0) return;
  const body = lines.slice(start + 1).map((l) => l.trim()).filter(Boolean);
  // Not a claim: an italic notice, a field left "Unknown", or something
  // the user typed ("Matched on: Ventura (from your search)").
  const notice = (l: string) => (/^_.*_$/.test(l) && !/\]\(/.test(l))
    || /^- \*\*[^*]+:\*\* Unknown$/.test(l) || /\(from your search|location from your search, not verified\)/.test(l);
  if (body.every(notice)) return;
  lines.length = start;
}

/** A sale's total when the row gives only a per-share price and a share count. */
function totalOf(f: Form4Entry): number | undefined {
  if (!f.value || !f.shares || !/per share|\/\s*share/i.test(f.value)) return undefined;
  const v = saleValue(f);
  return v > 0 ? v : undefined;
}

/** What kind of record a founding year came from (round 11: a LinkedIn page was labeled "state record"). */
export function foundedLabel(url: string): string {
  if (/sec\.gov/i.test(url)) return "10-K";
  if (/\.(gov|us)(\/|$)|sos\.|bizfile|opencorporates|corporations/i.test(url)) return "state record";
  return "source";
}

/** "https://www.businesswire.com/news/x" -> "businesswire.com". */
function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
