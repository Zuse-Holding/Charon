/**
 * Shared constants for the Deep Dive feature.
 * Lives in src/lib so both the CLI agent and the Next.js frontend
 * can import it without bundling the full agent.
 */

export const SECTION_ESTIMATES: Record<string, number> = {
  "Executive Brief": 15,
  "Founding & History": 20,
  "Leadership Deep Dive": 25,
  "Funding & Financials": 25,
  "Products & Traction": 25,
  "Risk Flags": 20,
  "Competitive Context": 25,
  "Market Sizing": 20,
  "Strategic Options": 20,
  "Verdict": 15,
};

export const SECTION_ORDER = Object.keys(SECTION_ESTIMATES);
export const TOTAL_ESTIMATED_SECONDS = Object.values(SECTION_ESTIMATES).reduce((a, b) => a + b, 0);
