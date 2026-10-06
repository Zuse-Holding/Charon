import {
  ISSUER_REQUIRED, normalizeIdentifierValue, normalizeIssuer, normalizeName, type IdentifierKind,
} from "./normalize.js";

/**
 * Identifier-based entity resolution (Feature 3).
 *
 *   - Two records are the same entity only when they share a hard
 *     identifier (an EIN, or an entity number from the same state).
 *   - A shared name alone never merges. It creates a separate entity and
 *     a "possible match" for a person to confirm or reject.
 *   - Same name with conflicting identifiers (two different entity
 *     numbers from the same state) stays separate and is labeled distinct.
 */

export type EntityType = "company" | "person" | "product";

export interface Identifier {
  kind: IdentifierKind;
  /** State, board or court that issued it; "" for national ones (EIN). */
  issuer: string;
  value: string;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
}

export type IdentifierKey = Pick<Identifier, "kind" | "issuer" | "value">;

export interface KnownEntity {
  id: string;
  name: string;
  type: EntityType;
  identifiers: IdentifierKey[];
}

export interface EntityCandidate {
  name: string;
  type: EntityType;
  identifiers: Identifier[];
}

export type Resolution =
  /** Shares a hard identifier with an existing entity: same entity. */
  | { action: "use"; entityId: string }
  /** New entity. possibleMatches share its name (and no conflicting
   *  identifier); distinctFrom share its name but not its identifiers. */
  | { action: "create"; possibleMatches: string[]; distinctFrom: string[] };

/** A usable identifier in canonical form, or undefined. Issuer-scoped
 *  kinds without an issuer are dropped: "entity number 123" alone could
 *  be any state's. */
export function canonicalIdentifier(id: Identifier): Identifier | undefined {
  const value = normalizeIdentifierValue(id.kind, id.value);
  const issuer = ISSUER_REQUIRED.has(id.kind) ? normalizeIssuer(id.issuer) : "";
  if (!value || (ISSUER_REQUIRED.has(id.kind) && !issuer)) return undefined;
  return { ...id, value, issuer };
}

export const keyOf = (i: IdentifierKey) => `${i.kind}|${i.issuer}|${i.value}`;

/** Both carry the same kind of identifier from the same issuer, with
 *  different values: provably different entities. */
export function conflicts(a: IdentifierKey[], b: IdentifierKey[]): boolean {
  return a.some((x) => b.some((y) => x.kind === y.kind && x.issuer === y.issuer && x.value !== y.value));
}

export function resolve(candidate: EntityCandidate, known: KnownEntity[]): Resolution {
  const sameType = known.filter((k) => k.type === candidate.type);
  const keys = new Set(candidate.identifiers.map(keyOf));
  const shared = sameType.find((k) => k.identifiers.some((i) => keys.has(keyOf(i))));
  if (shared) return { action: "use", entityId: shared.id };

  const name = normalizeName(candidate.name, candidate.type);
  const possibleMatches: string[] = [];
  const distinctFrom: string[] = [];
  for (const k of sameType) {
    if (!name || normalizeName(k.name, k.type) !== name) continue;
    (conflicts(candidate.identifiers, k.identifiers) ? distinctFrom : possibleMatches).push(k.id);
  }
  return { action: "create", possibleMatches, distinctFrom };
}
