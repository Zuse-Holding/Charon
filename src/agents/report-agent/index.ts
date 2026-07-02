import { PersonResearchBundle, ProductResearchBundle, ResearchBundle } from "../../types/research.js";

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

    lines.push(`## Executive Summary`);
    lines.push(
      bundle.person.summary
        ? bundle.person.summary
        : `_No summary data found for ${bundle.person.name}. Try a more specific name (e.g. add a company or title) to disambiguate._`
    );
    lines.push(``);

    lines.push(`## Current Role`);
    if (bundle.person.currentRole && bundle.person.currentCompany) {
      lines.push(`- **Role:** ${bundle.person.currentRole}`);
      lines.push(`- **Company:** ${bundle.person.currentCompany}`);
    } else {
      lines.push(`_No current role/company data collected in this pass._`);
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

    lines.push(`## Risks`);
    if (bundle.risks && bundle.risks.length > 0) {
      for (const r of bundle.risks) lines.push(`- ${r}`);
    } else {
      lines.push(`_Insufficient data for risk analysis on this run._`);
    }
    lines.push(``);

    lines.push(`## Opportunities`);
    if (bundle.opportunities && bundle.opportunities.length > 0) {
      for (const o of bundle.opportunities) lines.push(`- ${o}`);
    } else {
      lines.push(`_Insufficient data for opportunity analysis on this run._`);
    }
    lines.push(``);

    lines.push(`## Sources`);
    bundle.sources.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.title ?? s.url}](${s.url})`);
    });

    return lines.join("\n");
  }
}
