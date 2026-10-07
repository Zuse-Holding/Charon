/**
 * Registered agents and addresses that serve thousands of unrelated
 * companies (Feature 4). Linking through one would connect every client
 * of the agent, so they are excluded from link-building entirely.
 *
 * Two layers: this maintained list, and a size check in the engine (any
 * agent or address shared by more than MASS_THRESHOLD filings is treated
 * the same way), so an agent missing from the list still can't flood the
 * graph. Add names here when one turns up.
 */

export const MASS_THRESHOLD = 25;

const AGENT_NAMES = [
  "ct corporation", "c t corporation", "corporation service company", "csc", "csc lawyers incorporating service",
  "united states corporation agents", "registered agents inc", "northwest registered agent", "republic registered agent",
  "national registered agents", "legalinc", "legalzoom", "incorp services", "cogency global", "corporate creations",
  "national corporate research", "business filings incorporated", "harbor compliance", "zenbusiness", "sundoc filings",
  "wolters kluwer", "paracorp", "vcorp services", "capitol services", "a registered agent", "registered agent solutions",
  "the corporation trust company", "corporation trust company", "spiegel utrera", "nrai services", "inc plan",
  "delaware registered agent", "harvard business services", "american incorporators", "agents and corporations",
  "the company corporation", "incorporating services", "statutory agent", "unisearch", "corpomax",
];

/** Street lines (normalized) of well-known agent offices. */
const AGENT_ADDRESSES = [
  "1209 orange st", "251 little falls dr", "2711 centerville rd", "1013 centre rd", "8 the green", "16192 coastal hwy",
  "3500 s dupont hwy", "160 greentree dr", "2710 gateway oaks dr", "28 liberty st", "80 state st", "54 state st",
  "7014 13th ave", "99 washington ave", "818 w 7th st", "1999 bryan st", "1201 hays st",
];

const words = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const STREET = (s: string) => words(s)
  .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\broad\b/g, "rd").replace(/\bdrive\b/g, "dr")
  .replace(/\bhighway\b/g, "hwy").replace(/\bsuite\b|\bste\b|\bfloor\b|\bfl\b|\bunit\b|#/g, " ").replace(/\s+/g, " ").trim();

export function isMassAgentName(name: string | undefined): boolean {
  if (!name) return false;
  const n = ` ${words(name)} `;
  return AGENT_NAMES.some((a) => n.includes(` ${a} `)) || /\bregistered agents?\b/.test(n) && /\b(inc|llc|services|corp)\b/.test(n);
}

/** Normalized single-line address used as a link key: street + city + state. */
export function normalizeAddress(parts: (string | undefined)[]): string | undefined {
  const line = parts.filter((p) => p && p.trim()).map((p) => STREET(p!)).join(" ").replace(/\s+/g, " ").trim();
  return line.length >= 8 ? line : undefined;
}

export function isMassAgentAddress(address: string | undefined): boolean {
  if (!address) return false;
  return AGENT_ADDRESSES.some((a) => address.startsWith(a) || address.includes(` ${a} `));
}
