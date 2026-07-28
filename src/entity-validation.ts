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
    aka: ["Alan Meds", "Alan Health Technologies, Inc."],
    ceo: "Andrew McLeod",
    reject_domains: ["alan.com"],
  },
  // Raytheon Technologies legally renamed to RTX Corporation in July
  // 2023. Confirmed cause of a real production bug: SEC filings and
  // USASpending federal contract records are now filed under "RTX", so
  // searching "Raytheon" was failing the strict same-name grounding
  // checks in form4-agent and the recipient-name-match filter in
  // usaspending-agent — both correctly built to prevent misattribution,
  // but too strict for a company that legitimately changed its name.
  "raytheon": {
    canonical_name: "RTX Corporation",
    canonical_domain: "rtx.com",
    aka: ["Raytheon Technologies", "Raytheon Technologies Corporation", "Raytheon Company", "RTX Corp", "RTX"],
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
  if (!looksLikePersonName(extractedValue)) {
    return {
      valid: false,
      reason: `"${fieldName}" value "${extractedValue}" doesn't match expected person-name format.`,
      correctedValue: override?.ceo,
    };
  }

  return { valid: true };
}

/**
 * Bare format/plausibility check for "does this string look like a person's
 * name" — same org-token/shape heuristics validatePersonField above uses,
 * exposed standalone since not every caller has a PERSON_FIELDS field name
 * to hang the check off of. Added for handle-resolver-agent, which scores
 * name candidates pulled from bio text rather than validating a single
 * already-labeled fact field.
 */
export function looksLikePersonName(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  const tokens = normalized.split(/\s+/);
  if (ORG_TOKENS.some((t) => tokens.includes(t))) return false;

  const rawTokens = value.trim().split(/\s+/);
  return (
    rawTokens.length >= 2 &&
    rawTokens.length <= 4 &&
    rawTokens.every((t) => /^[A-Z][a-zA-Z'.-]*$/.test(t))
  );
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

/**
 * Per-entity domain block list. "Alan Health" is the motivating case:
 * search results for that name regularly surface alan.com (an unrelated
 * French health-insurance company) as a top hit. Originally defined only
 * inside website-agent (the first place this actually got wired in) —
 * moved here so every agent that runs a search for a company/person name
 * can drop the same rejected domains from its OWN results, not just the
 * one agent that resolves the "official website." A round from
 * corporate-agent or a headline from news-agent sourced off alan.com was
 * previously untouched by this filter and could still reach the LLM
 * prompt and the final report even when website-agent's own output was
 * clean. Now applied in corporate-agent, news-agent, and
 * competitor-agent too (7/20) — website-agent updated to import this
 * shared copy instead of keeping its own private one.
 */
/**
 * Appends Google/Serper `-site:` exclusion operators for an entity's
 * reject_domains directly onto a search query string. isRejectedDomain
 * above is a post-fetch drop — necessary regardless (an excluded domain
 * can still slip through indexing quirks), but exclusion at the query
 * itself means the 5-10 results budget per search isn't partly wasted on
 * hits that were only going to be thrown away, and reduces the odds a
 * wrong-entity snippet gets pulled into an LLM prompt at all. No-op
 * (returns the query unchanged) when there's no override or no
 * reject_domains — every call site can apply this unconditionally.
 */
export function appendDomainExclusions(query: string, override: EntityOverride | undefined): string {
  if (!override?.reject_domains?.length) return query;
  const exclusions = override.reject_domains.map((d) => `-site:${d}`).join(" ");
  return `${query} ${exclusions}`;
}

/**
 * True when `name` is literally an org's own registry key, canonical
 * name, or alias — i.e. a "person" search was actually run with a
 * company name as the subject (e.g. someone searches "Alan Health" with
 * the Person type selected). Exact match only, unlike findOverride's
 * prefix matching: this decides whether to swap the search subject out
 * for the org's known CEO entirely, so it needs to be conservative about
 * what counts as "this literally is the company name."
 */
export function resolveCompanyNameAsPerson(name: string): EntityOverride | undefined {
  const key = name.toLowerCase().trim();
  if (!key) return undefined;
  for (const [overrideKey, override] of Object.entries(ENTITY_OVERRIDES)) {
    const variants = [
      overrideKey,
      override.canonical_name.toLowerCase().trim(),
      ...override.aka.map((a) => a.toLowerCase().trim()),
    ];
    if (variants.includes(key)) return override;
  }
  return undefined;
}

export function isRejectedDomain(url: string, override: EntityOverride | undefined): boolean {
  if (!override?.reject_domains?.length) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return override.reject_domains.some((d) => d.replace(/^www\./, "") === hostname);
  } catch {
    return false;
  }
}

/**
 * Convenience: look up an override by any known alias.
 *
 * Two match strategies:
 *  1. Exact match against the registry key or a full aka string.
 *  2. Prefix match — the query is a word-boundary-safe prefix of the
 *     canonical name or an aka (e.g. "Raytheon Tech" -> "Raytheon
 *     Technologies"). Requires the query to be at least two words (or
 *     one long-ish word) so short, ambiguous queries like "co" can't
 *     match everything.
 *
 * (1) alone missed a real production case: "Raytheon Tech" isn't a
 * literal aka string, so it fell straight through the exact-match check
 * and reproduced the exact bug the "raytheon" override exists to fix,
 * just under a different informal name. Prefix matching covers informal
 * shorthand without needing every possible truncation listed by hand.
 */
export function findOverride(entityName: string): EntityOverride | undefined {
  const key = entityName.toLowerCase().trim();
  if (!key) return undefined;
  if (ENTITY_OVERRIDES[key]) return ENTITY_OVERRIDES[key];

  const queryWordCount = key.split(/\s+/).filter(Boolean).length;
  const longEnough = queryWordCount >= 2 || key.length >= 6;

  for (const [overrideKey, override] of Object.entries(ENTITY_OVERRIDES)) {
    const candidates = [
      overrideKey,
      override.canonical_name.toLowerCase().trim(),
      ...override.aka.map((a) => a.toLowerCase().trim()),
    ];

    const exact = candidates.find((c) => c === key && c.split(/\s+/).length >= 1);
    if (exact) return override;

    if (longEnough) {
      const prefixMatch = candidates.find(
        (c) => c.split(/\s+/).length >= 2 && c.startsWith(key)
      );
      if (prefixMatch) return override;
    }
  }
  return undefined;
}

// ── Cross-source person deduplication ───────────────────────────────────────────
// General entity-resolution gap, first hit by littlesis-agent: a source can
// return several distinct records for the same real person — LittleSis
// gives "Charles Koch" (41340), "Charles John Koch" (5125), and "Charles G.
// Koch" (465621) as three separate entity IDs for one individual, alongside
// "Chase Koch" (41698), who is a genuinely different person (his son). Any
// source returning a plain list of named people can hit this same problem,
// so this lives here rather than inside littlesis-agent.

/**
 * Normalizes a person's name to a first+last comparison key, dropping
 * middle names/initials and punctuation — "Charles G. Koch" and "Charles
 * John Koch" both key to "charles koch", same as plain "Charles Koch".
 * "Chase Koch" keys to "chase koch" and correctly stays distinct: first
 * names differ, so this never conflates two different real people who
 * merely share a surname.
 *
 * Known limitation, same class as PERSON_FIELDS' 2-4-token regex above:
 * doesn't handle nicknames ("Bill" vs "William") or non-Western name
 * order. Good enough for "does this source's own near-duplicate records
 * refer to the same person," not a general identity-resolution engine.
 */
export function personGroupKey(name: string): string {
  const tokens = name.replace(/[.,]/g, "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return name.toLowerCase().trim();
  return `${tokens[0].toLowerCase()} ${tokens[tokens.length - 1].toLowerCase()}`;
}

/** True if two person names share a first+last name per personGroupKey. */
export function samePerson(nameA: string, nameB: string): boolean {
  return personGroupKey(nameA) === personGroupKey(nameB);
}

/**
 * Collapses a list of items down to one per distinct `getKey` group,
 * keeping the richest item in each group (per `isRicher`) and preserving
 * first-occurrence order across groups. Deliberately generic — not
 * person-specific — so any source can dedupe on whatever key makes sense
 * for it; for people, pass `(item) => "person:" + personGroupKey(name)`
 * for person-typed items and a unique per-item key (e.g. a source ID) for
 * anything that should never merge with anything else.
 *
 * This is the "if genuinely ambiguous, surface the single highest-
 * confidence match rather than listing duplicates" behavior: a group of
 * 2+ items collapses to exactly one, chosen by `isRicher`, never a
 * dangling list of unresolved near-duplicates.
 */
export function mergeByKey<T>(items: T[], getKey: (item: T) => string, isRicher: (a: T, b: T) => boolean): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  return order.map((key) => groups.get(key)!.reduce((best, candidate) => (isRicher(candidate, best) ? candidate : best)));
}
