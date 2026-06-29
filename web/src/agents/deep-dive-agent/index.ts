import Groq from "groq-sdk";
import { SerperSearchProvider } from "../../lib/providers.js";

/**
 * Deep Dive Agent
 *
 * Produces an 8-section analyst-grade report by running targeted
 * per-section Serper searches and writing each section via Groq.
 * Unlike the quick profile (which extracts facts), this agent
 * synthesizes and writes prose — closer to what an analyst would
 * deliver than a data extraction tool would.
 *
 * Requires: GROQ_API_KEY + SERPER_API_KEY in .env
 * Cost: ~8 Groq calls (free tier, llama-3.1-8b-instant).
 * Time: ~60–120 seconds depending on Serper/Groq latency.
 */

const SECTIONS = [
  {
    key: "overview",
    title: "Company Overview & History",
    query: (co: string) => `${co} company history founded overview background`,
    prompt: (co: string) =>
      `Write a detailed Company Overview & History section for ${co}. Cover: when founded, by whom, original mission, major milestones, current focus, and any pivots. 3–4 paragraphs. Ground every fact in the search results provided.`,
  },
  {
    key: "leadership",
    title: "Founders & Leadership",
    query: (co: string) => `${co} CEO founder leadership team executives biography`,
    prompt: (co: string) =>
      `Write a Founders & Leadership section for ${co}. For each named individual: full name, title, background, relevant experience, and any notable flags or discrepancies. Be specific — name actual people, not "the leadership team."`,
  },
  {
    key: "funding",
    title: "Funding & Investors",
    query: (co: string) => `${co} funding investors venture capital seed series raised`,
    prompt: (co: string) =>
      `Write a Funding & Investors section for ${co}. Cover: total raised, round history (dates, amounts, lead investors), current capital position, and any opacity concerns. Flag if funding data is thin or unverifiable.`,
  },
  {
    key: "products",
    title: "Products & Services",
    query: (co: string) => `${co} products services offerings platform features pricing`,
    prompt: (co: string) =>
      `Write a Products & Services section for ${co}. Break out each distinct product line or service. Include: what it does, who it serves (B2C vs B2B), pricing model if known, and differentiation from competitors.`,
  },
  {
    key: "traction",
    title: "Traction & Market Signals",
    query: (co: string) => `${co} customers revenue growth traction traffic reviews patients users`,
    prompt: (co: string) =>
      `Write a Traction & Market Signals section for ${co}. Include any available signals: revenue estimates, traffic data, customer counts, review scores (Trustpilot, G2, etc.), patient/user volume, backlinks, or press coverage. Caveat estimates appropriately.`,
  },
  {
    key: "risks",
    title: "Risk Flags",
    query: (co: string) => `${co} risks challenges problems criticism regulatory legal complaints`,
    prompt: (co: string) =>
      `Write a Risk Flags section for ${co}. Use a HIGH / MEDIUM / LOW color-coded format for each risk. Cover: regulatory, competitive, financial, leadership, operational, and reputational risks. Be specific — generic risks are useless.`,
  },
  {
    key: "competitive",
    title: "Competitive Context",
    query: (co: string) => `${co} competitors alternatives comparison market landscape`,
    prompt: (co: string) =>
      `Write a Competitive Context section for ${co}. Name 3–5 actual competitors, describe how each differs, and place ${co} on the competitive map. Identify the one or two things ${co} would need to win.`,
  },
  {
    key: "acquisition",
    title: "Acquisition & Partnership Analysis",
    query: (co: string) => `${co} acquisition valuation partnership M&A deal`,
    prompt: (co: string) =>
      `Write an Acquisition & Partnership Analysis section for ${co}. Cover: (1) What you'd actually be buying — assets, IP, customer list, team. (2) Asset purchase vs. full acquisition — which makes more sense and why. (3) Estimated valuation range with methodology. (4) Capital requirements. (5) Key diligence items. Be direct and opinionated.`,
  },
];

export interface DeepDiveSection {
  title: string;
  content: string;
}

export interface DeepDiveBundle {
  company: string;
  generatedAt: string;
  sections: DeepDiveSection[];
  verdict: string;
}

export class DeepDiveAgent {
  private searcher: SerperSearchProvider;

  constructor(searcher: SerperSearchProvider) {
    this.searcher = searcher;
  }

  async run(companyName: string): Promise<DeepDiveBundle> {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY required for deep dive analysis");
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
    const sections: DeepDiveSection[] = [];

    console.log(`[deep-dive] Starting ${SECTIONS.length}-section analysis for "${companyName}"...`);

    for (const section of SECTIONS) {
      console.log(`[deep-dive] Writing: ${section.title}`);

      // Search for section-specific context
      const results = await this.searcher.search(section.query(companyName), 6);
      const context = results
        .map((r) => `[${r.title}]\n${(r as { snippet?: string }).snippet ?? ""}\n${r.url}`)
        .join("\n\n");

      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a senior business analyst writing a deep dive research report. Write dense, specific, operator-grade prose. Base everything on the search results provided. If data is genuinely unavailable, say so in one sentence and move on. No filler, no generic statements.",
            },
            {
              role: "user",
              content: `Company: ${companyName}\n\nSearch results:\n${context || "(no results found)"}\n\nTask: ${section.prompt(companyName)}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 700,
        });

        sections.push({
          title: section.title,
          content:
            completion.choices[0]?.message?.content ??
            "_No data available for this section._",
        });
      } catch (err) {
        console.error(`[deep-dive] Section failed (${section.title}):`, err);
        sections.push({
          title: section.title,
          content: "_Section unavailable — LLM error during generation._",
        });
      }
    }

    // Strategic Verdict — synthesize all sections
    console.log("[deep-dive] Writing strategic verdict...");
    const allContent = sections
      .map((s) => `## ${s.title}\n${s.content}`)
      .join("\n\n");

    let verdict = "_Verdict unavailable — synthesis failed._";
    try {
      const vCompletion = await groq.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a strategic advisor delivering a final verdict. Be direct and opinionated. Avoid hedging.",
          },
          {
            role: "user",
            content: `Company: ${companyName}\n\nFull research:\n${allContent}\n\nDeliver a Strategic Verdict covering all four paths:\n\n1. **Full Acquisition** — pros, cons, valuation range, recommended structure\n2. **Asset Purchase** — what to buy, why, price range\n3. **White-Label / Partnership** — feasibility, terms to push for\n4. **Go Solo** — build vs. buy rationale\n\nEnd with a single clear recommended path and why.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 900,
      });
      verdict =
        vCompletion.choices[0]?.message?.content ?? verdict;
    } catch (err) {
      console.error("[deep-dive] Verdict failed:", err);
    }

    return {
      company: companyName,
      generatedAt: new Date().toISOString(),
      sections,
      verdict,
    };
  }
}
