/**
 * Easter Egg Seed Reports
 * Pre-baked fictional company/person reports for demo and delight purposes.
 * Short-circuits the real research pipeline when one of these names is
 * searched — instant, consistent, zero API cost, zero risk of a weird
 * LLM hallucination during a live demo.
 *
 * Lookup is case-insensitive and matches on exact name or close alias.
 */

export interface EasterEggEntry {
  type: "company" | "person";
  aliases: string[]; // lowercase match targets
  markdown: string;
}

const now = () => new Date().toISOString();

export const EASTER_EGGS: EasterEggEntry[] = [
  // ───────────────────────── COMPANIES ─────────────────────────
  {
    type: "company",
    aliases: ["wayne enterprises", "wayne industries"],
    markdown: `# Wayne Enterprises — Research Report

*Generated ${now()}*

## Executive Summary
Wayne Enterprises is a Gotham City-based multinational conglomerate with operating divisions spanning aerospace and defense, applied sciences, biotechnology, and urban infrastructure. Founded on a legacy of industrial manufacturing, the company has repositioned over the past two decades toward advanced R&D and philanthropic-aligned ventures under the leadership of CEO Bruce Wayne. Wayne Enterprises is widely regarded as Gotham's largest private employer and a key civic stabilizer in a city with chronic governance challenges.

## Company Overview
- **Website:** wayneenterprises.com
- **Founded:** 1849
- **Headquarters:** Gotham City
- **Industry:** Diversified Conglomerate (Aerospace, Biotech, Applied Sciences, Infrastructure)

## Leadership
- **Bruce Wayne** — Chairman & CEO: Took control of the company following a multi-year board restructuring in his late twenties. Known for an unconventional, hands-off management style and frequent unexplained absences from public events.
- **Lucius Fox** — CEO, Applied Sciences Division: Long-tenured executive widely credited with the company's R&D resurgence. Holds final sign-off on all classified contracts.
- **Pennyworth, A.** — Special Advisor to the Chairman: Listed in corporate filings with an unusually broad advisory mandate.

## Products
_Best-effort extraction — may include false positives (marketing copy mistaken for product names)._

- **WayneTech Applied Sciences Division** (R&D) — Internal skunkworks division; public output limited, defense contract speculation in local press.
- **Wayne Aerospace** (Aerospace) — Commercial and government aerospace contracts, headquartered at a satellite campus outside Gotham.
- **Wayne Biotech** (Pharmaceuticals) — Active in infectious disease research; cited in several Gotham public health initiatives.

## Funding
**Ownership:** Privately held by the Wayne family with minority institutional shareholders.

- Series of internal capital allocations — Undisclosed (Ongoing) — Wayne Foundation

## Recent News
- [Wayne Enterprises Reaffirms Gotham HQ Commitment Amid Relocation Rumors](#) — Company spokesperson denies long-circulating rumors of a headquarters move following a turbulent fiscal quarter.
- [Applied Sciences Division Patent Filings Surge](#) — Quarterly filings show a notable uptick in advanced materials and robotics patents.

## Competitors
- **LexCorp** _(Primary rival — overlapping interests in applied sciences, biotech, and municipal infrastructure contracts)_
- **Stark Industries** _(Aerospace and defense technology overlap, different primary market)_
- **Cyberdyne Systems** _(Competing for select robotics and automation contracts)_

## Risks
- Heavy reliance on the personal involvement and public image of CEO Bruce Wayne — frequent unexplained absences raise governance continuity questions.
- Operating in Gotham City introduces elevated civic and security risk relative to peer conglomerates in more stable metros.
- Applied Sciences Division's classified contract work limits financial transparency and complicates standard due diligence.

## Opportunities
- Strong R&D pipeline in applied sciences and biotech positions the company well for defense and public-health contract growth.
- Deep civic infrastructure investment in Gotham creates durable, hard-to-replicate local market positioning.
- Significant balance sheet strength allows for opportunistic acquisitions during Gotham's recurring economic downturns.

## Sources
1. [Wayne Enterprises Corporate Filings](#)
2. [Gotham Gazette — Business Desk](#)
3. [Gotham Chamber of Commerce Annual Report](#)`,
  },

  {
    type: "company",
    aliases: ["stark industries"],
    markdown: `# Stark Industries — Research Report

*Generated ${now()}*

## Executive Summary
Stark Industries is a global technology and defense contractor headquartered in Malibu, California, with major manufacturing operations on the East Coast. Originally built as a traditional weapons manufacturer, the company underwent a dramatic strategic pivot away from weapons manufacturing toward clean energy and advanced materials science under CEO Tony Stark, a shift that significantly altered its government contract portfolio and public market positioning.

## Company Overview
- **Website:** starkindustries.com
- **Founded:** 1939
- **Headquarters:** Malibu, California
- **Industry:** Aerospace, Defense Technology, Clean Energy

## Leadership
- **Tony Stark** — CEO & Chief Engineer: Took over the company following the death of his father, Howard Stark. Publicly announced a full divestment from traditional weapons manufacturing, triggering significant short-term market volatility.
- **Pepper Potts** — President & COO: Former personal assistant to the CEO promoted to the executive suite; widely credited with stabilizing operations during the company's strategic pivot.
- **Happy Hogan** — Head of Security: Oversees executive protection and physical security for all company facilities.

## Products
_Best-effort extraction — may include false positives (marketing copy mistaken for product names)._

- **Arc Reactor Technology** (Clean Energy) — Proprietary energy generation platform; primary driver of the company's post-pivot valuation.
- **Stark Aerospace Defense Systems** (Aerospace/Defense) — Legacy defense contracting division, scaled down but still operational.
- **Stark Mobile Devices** (Consumer Electronics) — Smaller consumer-facing product line, modest revenue contribution.

## Funding
**Ownership:** Publicly traded, majority founder-controlled voting shares.

- IPO — Undisclosed (Legacy listing, pre-2008 strategic pivot)

## Recent News
- [Stark Industries Reports Strong Quarter Despite Defense Contract Wind-Down](#) — Clean energy division revenue offsets continued decline in legacy defense contracts.
- [Board Confirms Continued Confidence in Current Leadership](#) — Statement follows a turbulent year of leadership transitions and public scrutiny.

## Competitors
- **Wayne Enterprises** _(Overlapping aerospace and applied sciences interests)_
- **Hammer Industries** _(Direct defense-sector competitor, attempted to fill the gap left by Stark's weapons divestment)_
- **Oscorp** _(Competing in advanced materials and biotech-adjacent research)_

## Risks
- Significant strategic and reputational dependency on a single high-profile CEO with an unconventional public persona.
- Full divestment from weapons manufacturing has materially altered the company's traditional government revenue streams.
- Proprietary arc reactor technology, while a strength, also concentrates significant technological and security risk in a single innovation.

## Opportunities
- First-mover advantage in clean energy technology with no clear competitor at comparable scale.
- Strong brand recognition provides pricing power and partnership leverage across new market verticals.
- Significant unencumbered IP portfolio offers licensing revenue potential beyond core operations.

## Sources
1. [Stark Industries Investor Relations](#)
2. [TechCrunch — Stark Industries Coverage Archive](#)
3. [SEC Filings Database](#)`,
  },

  {
    type: "company",
    aliases: ["lexcorp", "lex corp"],
    markdown: `# LexCorp — Research Report

*Generated ${now()}*

## Executive Summary
LexCorp is a Metropolis-based multinational conglomerate with diversified holdings across biotechnology, media, real estate, and advanced technology. The company has cultivated a reputation as a dominant civic and economic force in Metropolis under the leadership of founder and CEO Alexander "Lex" Luthor, whose public profile and political ambitions have frequently intersected with the company's business operations.

## Company Overview
- **Website:** lexcorp.com
- **Founded:** 1988
- **Headquarters:** Metropolis
- **Industry:** Biotechnology, Media, Real Estate, Advanced Technology

## Leadership
- **Lex Luthor** — Founder & CEO: Built the company from a single research lab into a diversified conglomerate. Maintains an unusually high public profile relative to peer CEOs, including periods of direct political involvement.
- **Mercy Graves** — Chief of Staff & Head of Security: Long-tenured executive with broad authority across the CEO's office and corporate security operations.

## Products
_Best-effort extraction — may include false positives (marketing copy mistaken for product names)._

- **LexCorp Biotech Division** (Biotechnology) — Active in genetic research; subject of periodic regulatory scrutiny.
- **LexCorp Towers** (Real Estate) — Flagship Metropolis headquarters and commercial real estate portfolio.
- **LexCorp Media Holdings** (Media) — Minority stake in several regional media outlets.

## Funding
**Ownership:** Privately held, majority controlled by founder.

- Self-funded founding round — Undisclosed (1988) — Founder capital

## Recent News
- [LexCorp Biotech Division Faces Renewed Regulatory Inquiry](#) — Latest in a recurring pattern of regulatory attention toward the company's genetic research programs.
- [CEO Luthor Addresses Metropolis Chamber of Commerce](#) — Wide-ranging remarks on civic investment and the company's long-term Metropolis commitment.

## Competitors
- **Wayne Enterprises** _(Primary national rival across applied sciences and infrastructure)_
- **S.T.A.R. Labs** _(Direct competitor in advanced research, smaller scale)_
- **Stark Industries** _(Overlapping interests in advanced technology)_

## Risks
- Recurring regulatory scrutiny of the Biotech Division introduces ongoing legal and reputational exposure.
- Heavy concentration of public identity and decision-making authority in a single, politically active founder-CEO.
- Operating almost entirely within Metropolis limits geographic diversification relative to national competitors.

## Opportunities
- Deep, multi-decade civic and political relationships in Metropolis create durable competitive moats in real estate and infrastructure bidding.
- Diversified holding structure provides resilience against single-sector downturns.
- Significant capital reserves position the company for opportunistic acquisitions of distressed competitors.

## Sources
1. [LexCorp Corporate Disclosures](#)
2. [Daily Planet — Business Section](#)
3. [Metropolis Chamber of Commerce Records](#)`,
  },

  {
    type: "company",
    aliases: ["cyberdyne systems", "cyberdyne"],
    markdown: `# Cyberdyne Systems — Research Report

*Generated ${now()}*

## Executive Summary
Cyberdyne Systems is a defense-adjacent robotics and artificial intelligence research firm historically based in the Los Angeles area. The company built its early reputation on advanced microprocessor and neural-net research contracts, with a public profile that has fluctuated significantly based on the perceived sensitivity of its government and defense partnerships.

## Company Overview
- **Website:** Unknown
- **Founded:** 1984
- **Headquarters:** Los Angeles, California
- **Industry:** Robotics, Artificial Intelligence, Defense Technology

## Leadership
- **Miles Dyson** — Director of Special Projects: Listed in archival filings as the lead architect of the company's most significant — and most disputed — research initiative. Current organizational status unclear.

## Products
_Best-effort extraction — may include false positives (marketing copy mistaken for product names)._

- **Neural-Net Processor Series** (AI/Robotics) — Core proprietary technology platform; details largely classified or unavailable in public filings.

## Funding
**Ownership:** Historically held a significant U.S. government contract relationship; current ownership structure unclear in available sources.

_No funding data collected in this pass._

## Recent News
_No recent news found._

## Competitors
- **Wayne Enterprises** _(Overlapping robotics and automation R&D)_
- **Stark Industries** _(Competing advanced technology and defense contractor)_

## Risks
- Extremely limited public disclosure makes standard financial and operational due diligence largely infeasible.
- Historical association with classified defense research introduces significant regulatory and reputational uncertainty.
- Apparent gaps in continuous public operating history raise questions about current organizational status.

## Opportunities
- Deep historical expertise in neural-net and robotics research represents a potentially valuable, if dormant, IP base.
- Defense-sector relationships, if reactivated, could provide a fast path back to significant government contract revenue.

## Sources
1. [Public Defense Contract Archive](#)
2. [Los Angeles Times — Technology Desk Archive](#)`,
  },

  // ───────────────────────── PEOPLE ─────────────────────────
  {
    type: "person",
    aliases: ["bruce wayne"],
    markdown: `# Bruce Wayne — Person Research Report

*Generated ${now()}*

## Executive Summary
Bruce Wayne is the Chairman and CEO of Wayne Enterprises, a Gotham City-based multinational conglomerate. Orphaned at a young age following the high-profile deaths of his parents, Wayne spent an unusually long period abroad before returning to Gotham to assume control of the family company. He is widely known in Gotham social and business circles for his philanthropic work through the Wayne Foundation, alongside a public reputation as a reclusive, unpredictable figure.

## Current Role
_Best-effort, based on the top-ranked search result — verify before relying on this._

- **Role:** Chairman & CEO
- **Company:** Wayne Enterprises

## Career History
_Best-effort extraction from search snippets — not necessarily in chronological order._

- Chairman & CEO at Wayne Enterprises
- Founder at Wayne Foundation (philanthropic arm)
- Extended period of unexplained international travel prior to assuming company leadership

## Recent News
- [Bruce Wayne Makes Rare Public Appearance at Gotham Gala](#) — CEO's infrequent public appearances continue to draw significant local media attention.
- [Wayne Foundation Announces Major Gotham Infrastructure Grant](#) — Latest in a long pattern of philanthropic investment in underserved Gotham districts.

## Sources
1. [Gotham Gazette — Society Pages Archive](#)
2. [Wayne Foundation Public Filings](#)`,
  },

  {
    type: "person",
    aliases: ["tony stark", "anthony stark"],
    markdown: `# Tony Stark — Person Research Report

*Generated ${now()}*

## Executive Summary
Tony Stark is the CEO and Chief Engineer of Stark Industries, a global aerospace, defense, and clean energy technology firm. He assumed leadership of the company following the death of his father, Howard Stark, and is widely credited with engineering the company's dramatic strategic pivot away from traditional weapons manufacturing. Stark maintains an unusually high public profile for a sitting CEO, frequently appearing in media coverage independent of company business.

## Current Role
_Best-effort, based on the top-ranked search result — verify before relying on this._

- **Role:** CEO & Chief Engineer
- **Company:** Stark Industries

## Career History
_Best-effort extraction from search snippets — not necessarily in chronological order._

- CEO & Chief Engineer at Stark Industries
- Previously Head of Weapons Development at Stark Industries (division since divested)
- Founding contributor to Arc Reactor clean energy platform

## Recent News
- [Tony Stark Addresses Shareholders on Clean Energy Pivot](#) — Continued public commentary on the company's multi-year strategic transformation.
- [Stark Spotted at International Technology Summit](#) — High-profile public appearance fuels continued media speculation about the company's next major announcement.

## Sources
1. [Stark Industries Investor Relations]( #)
2. [TechCrunch — Stark Coverage Archive](#)`,
  },

  {
    type: "person",
    aliases: ["lex luthor", "alexander luthor"],
    markdown: `# Lex Luthor — Person Research Report

*Generated ${now()}*

## Executive Summary
Lex Luthor is the founder and CEO of LexCorp, a Metropolis-based diversified conglomerate spanning biotechnology, media, and real estate. A prominent and at times politically active public figure in Metropolis, Luthor built the company from a single research lab into one of the city's dominant economic forces, while maintaining an unusually high-profile public persona relative to typical corporate executives.

## Current Role
_Best-effort, based on the top-ranked search result — verify before relying on this._

- **Role:** Founder & CEO
- **Company:** LexCorp

## Career History
_Best-effort extraction from search snippets — not necessarily in chronological order._

- Founder & CEO at LexCorp
- Brief period of direct political involvement in Metropolis civic affairs
- Frequent public commentary on Metropolis economic and infrastructure policy

## Recent News
- [Luthor Addresses Metropolis Chamber of Commerce](#) — Wide-ranging remarks on civic investment and long-term business commitment to the city.
- [LexCorp Biotech Division Faces Renewed Regulatory Inquiry](#) — Latest in a recurring pattern of regulatory attention toward the company's research programs.

## Sources
1. [Daily Planet — Business Section Archive](#)
2. [Metropolis Chamber of Commerce Records](#)`,
  },

  // ───────────────────────── INTENTIONAL EMPTY RESULT ─────────────────────────
  {
    type: "person",
    aliases: ["patrick bateman"],
    markdown: `# Patrick Bateman — Person Research Report

*Generated ${now()}*

## Executive Summary
_No verifiable records found. Available sources are inconsistent or contradictory regarding employment history, current role, and basic biographical details. This profile could not be confirmed against reliable public records._

## Current Role
_No current role/company data collected in this pass. Multiple sources conflict — listed title, employer, and even physical description vary significantly between records reviewed._

## Career History
_No verifiable career history could be assembled. Records suggest employment in financial services, though specific role, dates, and employer could not be confirmed across sources._

## Recent News
_No recent news found._

## Sources
_No sources could be verified as reliable for this individual._`,
  },
];

/**
 * Look up an easter egg entry by name (case-insensitive, alias-matched).
 * Returns null if no match — caller should fall through to the real pipeline.
 */
export function findEasterEgg(query: string): EasterEggEntry | null {
  const normalized = query.trim().toLowerCase();
  for (const entry of EASTER_EGGS) {
    if (entry.aliases.some((alias) => alias === normalized)) {
      return entry;
    }
  }
  return null;
}
