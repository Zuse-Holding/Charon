import { PersonResearchBundle, PoliticalResearchBundle, ProductResearchBundle, ResearchBundle } from "../../types/research.js";

/**
 * Report Agent
 * Turns a structured ResearchBundle into the Sprint 1 markdown report.
 * Sections present in spec but with no data yet (Risks, Opportunities —
 * those need analytical synthesis, slated for a later sprint) are
 * included as placeholders so the report shape is stable from day one.
 */
export class ReportAgent {
  generate(bundle: ResearchBundle): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.company.name} — Research Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(``);

    lines.push(`## Executive Summary`);
    lines.push(
      bundle.company.description
        ? bundle.company.description
        : `_No summary data found for ${bundle.company.name}. Try refining the company name or check network/source access._`
    );
    lines.push(``);

    lines.push(`## Company Overview`);
    lines.push(`- **Website:** ${bundle.company.website ?? "Unknown"}`);
    lines.push(`- **Founded:** ${bundle.company.founded ?? "Unknown"}`);
    lines.push(
      `- **Headquarters:** ${bundle.company.headquarters ?? "Unknown"}`
    );
    lines.push(`- **Industry:** ${bundle.company.industry ?? "Unknown"}`);
    lines.push(``);

    lines.push(`## Leadership`);
    if (bundle.leadership.length === 0) {
      lines.push(`_No leadership data collected in this pass._`);
    } else {
      for (const l of bundle.leadership) {
        lines.push(`- **${l.name}** — ${l.title}${l.bio ? `: ${l.bio}` : ""}`);
      }
    }
    lines.push(``);

    lines.push(`## Products`);
    if (bundle.products.length === 0) {
      lines.push(`_No product data collected in this pass._`);
    } else {
      for (const p of bundle.products) {
        lines.push(
          `- **${p.name}**${p.category ? ` (${p.category})` : ""}${
            p.description ? ` — ${p.description}` : ""
          }`
        );
      }
    }
    lines.push(``);

    lines.push(`## Funding`);
    if (bundle.ownership) {
      lines.push(`**Ownership:** ${bundle.ownership}`);
      lines.push(``);
    }
    if (bundle.funding.length === 0) {
      lines.push(`_No funding data collected in this pass._`);
    } else {
      for (const f of bundle.funding) {
        lines.push(
          `- ${f.round ?? "Round"}: ${f.amount ?? "Undisclosed"}${
            f.date ? ` (${f.date})` : ""
          }${f.investors?.length ? ` — ${f.investors.join(", ")}` : ""}`
        );
      }
    }
    lines.push(``);

    if (bundle.federalSpending && bundle.federalSpending.length > 0) {
      lines.push(`## Federal Spending`);
      for (const f of bundle.federalSpending) {
        lines.push(
          `- **${f.amount ?? "Undisclosed"}**${f.awardType ? ` (${f.awardType})` : ""} — ${
            f.awardingAgency ?? "Unknown agency"
          }${f.date ? ` (${f.date})` : ""}${f.description ? `: ${f.description}` : ""}`
        );
      }
      lines.push(``);
    }

    if (bundle.insiderActivity && bundle.insiderActivity.length > 0) {
      lines.push(`## Insider Activity`);
      for (const f of bundle.insiderActivity) {
        lines.push(
          `- **${f.filerName}**${f.relationship ? ` (${f.relationship})` : ""} — ${
            f.transactionType ?? "Filing"
          }${f.shares ? ` · ${f.shares} shares` : ""}${f.value ? ` · ${f.value}` : ""}${
            f.date ? ` (${f.date})` : ""
          }`
        );
      }
      lines.push(``);
    }

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(
          `- [${n.headline}](${n.url ?? "#"})${
            n.summary ? ` — ${n.summary}` : ""
          }`
        );
      }
    }
    lines.push(``);

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

    lines.push(`## Risks`);
    if (bundle.risks && bundle.risks.length > 0) {
      for (const risk of bundle.risks) {
        lines.push(`- ${risk}`);
      }
    } else {
      lines.push(`_Insufficient data for risk analysis on this run._`);
    }
    lines.push(``);

    lines.push(`## Opportunities`);
    if (bundle.opportunities && bundle.opportunities.length > 0) {
      for (const opp of bundle.opportunities) {
        lines.push(`- ${opp}`);
      }
    } else {
      lines.push(`_Insufficient data for opportunity analysis on this run._`);
    }
    lines.push(``);

    lines.push(`## Sources`);
    if (bundle.sources.length === 0) {
      lines.push(`_No sources recorded._`);
    } else {
      bundle.sources.forEach((s, i) => {
        lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
      });
    }

    return lines.join("\n");
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
    lines.push(``);

    lines.push(`## About`);
    lines.push(
      bundle.person.summary
        ? bundle.person.summary
        : `_No summary data found for ${bundle.person.name}._`
    );
    lines.push(``);

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

    lines.push(`## Career History`);
    if (bundle.careerHistory.length === 0) {
      lines.push(`_No career history collected in this pass._`);
    } else {
      for (const c of bundle.careerHistory) {
        lines.push(`- ${c.title}${c.company ? ` at ${c.company}` : ""}`);
      }
    }
    lines.push(``);

    // Jackal Person Research (Round 3) — only present on deep/internal-tier
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
    }

    if (bundle.foiaRequests && bundle.foiaRequests.length > 0) {
      lines.push(`## FOIA Requests`);
      for (const f of bundle.foiaRequests) {
        lines.push(
          `- [${f.title}](${f.url})${f.status ? ` — ${f.status}` : ""}${f.agency ? ` (${f.agency})` : ""}`
        );
      }
      lines.push(``);
    }

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(
          `- [${n.headline}](${n.url ?? "#"})${
            n.summary ? ` — ${n.summary}` : ""
          }`
        );
      }
    }
    lines.push(``);

    lines.push(`## Sources`);
    if (bundle.sources.length === 0) {
      lines.push(`_No sources recorded._`);
    } else {
      bundle.sources.forEach((s, i) => {
        lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
      });
    }

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

    lines.push(`## Product Details`);
    lines.push(`- **Brand / Manufacturer:** ${bundle.product.brand ?? "Unknown"}`);
    lines.push(`- **Category:** ${bundle.product.category ?? "Unknown"}`);
    lines.push(`- **Price:** ${bundle.product.price ?? "Unknown"}`);
    lines.push(``);

    lines.push(`## Specs`);
    if (bundle.specs.length === 0) {
      lines.push(`_No specs collected._`);
    } else {
      for (const s of bundle.specs) {
        lines.push(`- **${s.label}:** ${s.value}`);
      }
    }
    lines.push(``);

    lines.push(`## Competing Products`);
    if (bundle.competitors.length === 0) {
      lines.push(`_No competing products identified._`);
    } else {
      for (const c of bundle.competitors) {
        lines.push(`- **${c.name}**${c.note ? ` — ${c.note}` : ""}`);
      }
    }
    lines.push(``);

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(`- [${n.headline}](${n.url ?? "#"})${n.summary ? ` — ${n.summary}` : ""}`);
      }
    }
    lines.push(``);

    lines.push(`## Pros`);
    if (bundle.pros && bundle.pros.length > 0) {
      for (const p of bundle.pros) lines.push(`- ${p}`);
    } else {
      lines.push(`_Insufficient review data for this run._`);
    }
    lines.push(``);

    lines.push(`## Cons`);
    if (bundle.cons && bundle.cons.length > 0) {
      for (const c of bundle.cons) lines.push(`- ${c}`);
    } else {
      lines.push(`_Insufficient review data for this run._`);
    }
    lines.push(``);

    lines.push(`## Verdict`);
    if (bundle.verdict) {
      lines.push(bundle.verdict);
    } else {
      lines.push(`_Insufficient data for a verdict on this run._`);
    }
    lines.push(``);

    lines.push(`## Sources`);
    bundle.sources.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
    });

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
    }

    lines.push(`## Executive Summary`);
    lines.push(
      bundle.profile.summary
        ? bundle.profile.summary
        : `_No summary data found for ${bundle.profile.name}._`
    );
    lines.push(``);

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
    lines.push(``);

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

    lines.push(`## Voting Record`);
    if (bundle.votingRecord.length === 0) {
      lines.push(`_Best-effort from open sources — specific named votes only appear here when public coverage discusses them directly. See Sponsored Legislation below for a complete, API-verified list of bills this member has introduced._`);
    } else {
      for (const v of bundle.votingRecord) {
        lines.push(`- **${v.bill}** — ${v.position}${v.note ? `: ${v.note}` : ""}`);
      }
    }
    lines.push(``);

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
    }

    if (bundle.foiaRequests && bundle.foiaRequests.length > 0) {
      lines.push(`## FOIA Requests`);
      for (const f of bundle.foiaRequests) {
        lines.push(
          `- [${f.title}](${f.url})${f.status ? ` — ${f.status}` : ""}${f.agency ? ` (${f.agency})` : ""}`
        );
      }
      lines.push(``);
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

    lines.push(`## Recent News`);
    if (bundle.news.length === 0) {
      lines.push(`_No recent news found._`);
    } else {
      for (const n of bundle.news) {
        lines.push(`- [${n.headline}](${n.url ?? "#"})${n.summary ? ` — ${n.summary}` : ""}`);
      }
    }
    lines.push(``);

    lines.push(`## Sources`);
    if (bundle.sources.length === 0) {
      lines.push(`_No sources recorded._`);
    } else {
      bundle.sources.forEach((s, i) => {
        lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
      });
    }

    return lines.join("\n");
  }
}
