/**
 * Entity Validation Layer
 * Catches cases where LLM extraction returns an org name instead of a person
 * name for fields like ceo, founder, cto. Applies heuristics + known overrides.
 * Wire into the fact-write path before any kg_entities insert.
 */

export interface EntityOverride {
  canonical_name: string;
  canonical_domain: string;
  aka: string[];
  ceo?: string;
  reject_domains?: string[];
}

// ── Known overrides ───────────────────────────────────────────────────────────
// Add entries here whenever an entity causes repeated extraction failures.

export const ENTITY_OVERRIDES: Record<string, EntityOverride> = {
  "alan health": {
    canonical_name: "Alan Health Technologies",
    canonical_domain: "alanmeds.com",
    aka: ["Alan Meds", "Alan Health Technologies, Inc.", "Alan"],
    ceo: "Andrew McLeod",
    reject_domains: ["alan.com"],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Tokens that should never appear in a person's name field
const ORG_TOKENS = [
  "health", "technologies", "inc", "corp", "corporation", "llc",
  "labs", "group", "holdings", "co", "company", "ltd", "partners",
  "ventures", "solutions", "systems", "meds", "pharma", "bio",
  "capital", "fund", "management", "services", "consulting",
];

const PERSON_FIELDS = ["ceo", "founder", "cto", "cfo", "president", "coo"];

interface FieldValidationResult {
  valid: boolean;
  reason?: string;
  correctedValue?: string;
}

function validatePersonField(
  fieldName: string,
  extractedValue: string,
  entityKey: string,
  override?: EntityOverride
): FieldValidationResult {
  const normalized = extractedValue.toLowerCase().trim();

  // 1. Direct match against the org's own name or known aliases
  if (override) {
    const orgVariants = [override.canonical_name, ...override.aka, entityKey]
      .map((s) => s.toLowerCase().trim());
    if (orgVariants.includes(normalized)) {
      return {
        valid: false,
        reason: `"${fieldName}" value "${extractedValue}" matches the org name — extraction returned the company, not a person.`,
        correctedValue: override.ceo,
      };
    }
  }

  // 2. Contains org-type token
  const tokens = normalized.split(/\s+/);
  const containsOrgToken = ORG_TOKENS.some((t) => tokens.includes(t));
  if (containsOrgToken) {
    return {
      valid: false,
      reason: `"${fieldName}" value "${extractedValue}" contains an org-type token — likely not a person name.`,
      correctedValue: override?.ceo,
    };
  }

  // 3. Person names: 2-4 tokens, each starting with a capital, no digits
  const rawTokens = extractedValue.trim().split(/\s+/);
  const looksLikePerson =
    rawTokens.length >= 2 &&
    rawTokens.length <= 4 &&
    rawTokens.every((t) => /^[A-Z][a-zA-Z'.-]*$/.test(t));

  if (!looksLikePerson) {
    return {
      valid: false,
      reason: `"${fieldName}" value "${extractedValue}" doesn't match expected person-name format.`,
      correctedValue: override?.ceo,
    };
  }

  return { valid: true };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateAndCorrectFact(
  entityKey: string,
  fact: { field: string; value: string; sourceUrl?: string },
  override?: EntityOverride
): { field: string; value: string; flagged: boolean; note?: string } {
  if (!PERSON_FIELDS.includes(fact.field)) {
    return { field: fact.field, value: fact.value, flagged: false };
  }

  const result = validatePersonField(fact.field, fact.value, entityKey, override);

  if (!result.valid) {
    console.warn(`[entity-validation] Flagged: ${result.reason}`);
    return {
      field: fact.field,
      value: result.correctedValue ?? fact.value,
      flagged: true,
      note: result.reason,
    };
  }

  return { field: fact.field, value: fact.value, flagged: false };
}

/** Convenience: look up an override by any known alias */
export function findOverride(entityName: string): EntityOverride | undefined {
  const key = entityName.toLowerCase().trim();
  if (ENTITY_OVERRIDES[key]) return ENTITY_OVERRIDES[key];

  // Check aliases
  for (const [, override] of Object.entries(ENTITY_OVERRIDES)) {
    if (override.aka.map((a) => a.toLowerCase()).includes(key)) {
      return override;
    }
  }
  return undefined;
}
