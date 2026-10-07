/**
 * Name and identifier normalization for entity resolution (Feature 3).
 *
 * Normalized names are for finding candidates ("possible match") only.
 * They are never a merge key: two records merge only when they share a
 * hard identifier (see resolve.ts).
 */

const BUSINESS_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
  "lp", "llp", "lllp", "plc", "pc", "pllc", "gmbh", "sa", "ag", "bv", "nv",
]);

function words(name: string): string[] {
  return name
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** "The Acme Co., LLC" -> "acme". Strips a leading "the" and trailing
 *  legal-form words; keeps everything else. */
export function normalizeBusinessName(name: string): string {
  const w = words(name);
  if (w[0] === "the" && w.length > 1) w.shift();
  for (;;) {
    if (w.length > 3 && w.slice(-3).join(" ") === "l l c") w.splice(-3);
    else if (w.length > 1 && BUSINESS_SUFFIXES.has(w[w.length - 1])) w.pop();
    else break;
  }
  return w.join(" ");
}

export function normalizePersonName(name: string): string {
  return words(name).join(" ");
}

export function normalizeName(name: string, type: string): string {
  return type === "person" ? normalizePersonName(name) : normalizeBusinessName(name);
}

export const IDENTIFIER_KINDS = ["state_entity_number", "ein", "ucc_filing", "license", "court_party_id"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/** Kinds that only mean something together with who issued them: entity
 *  numbers repeat across states, license numbers across boards. */
export const ISSUER_REQUIRED: ReadonlySet<IdentifierKind> = new Set(["state_entity_number", "ucc_filing", "license", "court_party_id"]);

/** Canonical form of an identifier value, or undefined if it isn't a
 *  usable one (an EIN must be nine digits, for example). */
export function normalizeIdentifierValue(kind: IdentifierKind, value: string): string | undefined {
  if (kind === "ein") {
    const digits = value.replace(/\D/g, "");
    return digits.length === 9 ? digits : undefined;
  }
  const v = value.toUpperCase().replace(/\s+/g, "");
  return v.length > 0 ? v : undefined;
}

export function normalizeIssuer(issuer: string | undefined): string {
  return (issuer ?? "").trim().toLowerCase();
}
