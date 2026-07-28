import { PowerMapEntry, Source } from "../../types/research.js";
import { mergeByKey, personGroupKey } from "../../entity-validation.js";

/**
 * LittleSis Agent (7/20 public-record fusion, roadmap #3 — the
 * cross-entity resolution layer) — searches LittleSis's power-mapping
 * database (people/orgs/boards, run by the Public Accountability
 * Initiative) for a name. No API key required. Relevant to both company
 * and person research, same as ProPublica Nonprofit — LittleSis indexes
 * both entity kinds under one search.
 *
 * By default this only surfaces *candidate* matches (LittleSis's own
 * entity records) for the report — pulling relationships for every match
 * would be a much heavier, slower call than every proAccess (Pro/Team+)
 * research run should pay for. Pass `includeRelationships: true` (Charon/
 * internal-tier only, same "deep" gate OpenCorporates/MuckRock/ICIJ
 * already use — see orchestrator.researchPerson/researchCompany) to also
 * pull the matched entity's relationships (Stage 2), filtered to the
 * categories worth feeding into the Knowledge Graph: board/officer
 * positions, group memberships, family ties, donations, and ownership
 * stakes. Everything else (social ties, generic transactions, lobbying,
 * education) is noise for graph purposes and dropped.
 *
 * Checked live before wiring this in: no API key required, no
 * X-RateLimit-* response headers on either endpoint, Cache-Control:
 * max-age=120 suggests LittleSis expects/tolerates caching. No published
 * hard limit found, so this stays conservative anyway — one search call,
 * then up to 5 parallel single-page relationship calls (one per
 * whitelisted category; LittleSis's `category_id` filter param only
 * accepts one value at a time — a comma-list or `category_id[]=` array
 * silently misbehaves, confirmed live), never on an automatic/background
 * path (matches courtlistener-agent's same on-demand-only posture).
 */

const LITTLESIS_BASE = "https://littlesis.org/api";

interface LittleSisEntityAttributes {
  id: number;
  name: string;
  blurb?: string;
  primary_ext?: string; // "Person" | "Org"
}

interface LittleSisEntity {
  type: string;
  id: number;
  attributes: LittleSisEntityAttributes;
}

interface LittleSisSearchResponse {
  data?: LittleSisEntity[];
}

interface LittleSisRelationshipAttributes {
  id: number;
  entity1_id: number;
  entity2_id: number;
  category_id: number;
  description1?: string | null; // role text on entity1's side, e.g. "founder" (Position), "father" (Family)
  description2?: string | null; // role text on entity2's side, e.g. "son" (Family)
  description?: string;
}

interface LittleSisRelationshipRecord {
  type: string;
  id: number;
  attributes: LittleSisRelationshipAttributes;
  entity: string;  // page URL for entity1
  related: string; // page URL for entity2
}

interface LittleSisRelationshipsResponse {
  data?: LittleSisRelationshipRecord[];
}

// LittleSis relationship category IDs -> Knowledge Graph edge type. These
// six are worth graphing (per the roadmap ask: board membership,
// donations, family ties, business connections) — confirmed live against
// real category_id values and their `description` text (e.g. category 5
// reads "X gave money to Y", category 10 reads "X is/was an owner of Y",
// category 9 reads "X and Y have a professional relationship" — a real
// business-connection category, initially missed when this list was
// first scoped).
const RELEVANT_CATEGORIES: Record<number, string> = {
  1: "POSITION_AT",     // officer/employee/board position — see description1 for the actual title
  3: "MEMBER_OF",        // group/coalition/board membership
  4: "FAMILY_OF",
  5: "DONATED_TO",
  9: "PROFESSIONAL_CONNECTION_TO",
  10: "OWNER_OF",
};
// Per-category cap on a single page of results (LittleSis returns up to
// 100 rows/page, most-recently-updated first). 4 was too aggressive —
// checked live against Charles Koch (entity 41340): 86 total relationships
// across these categories, 49 of them Donation alone, all on page 1
// (pageCount: 1) — a cap of 4/category was discarding the large majority
// of real, current data, not just trimming a long tail. 10/category (up
// to 50 total across 6 categories) matches the "top 25-50" range the
// dedup/relevance-floor fix used for ICIJ. Not paginating past page 1:
// every category checked live for both test subjects (Koch, Soros) fit
// within one page at this cap, and page 1 is already the most-recent
// slice — acceptable per the original scoping ask's own "or set a
// reasonable higher cap" alternative to full pagination. Revisit with
// real multi-page fetching only if a future subject's single category
// genuinely exceeds 100 rows AND that overflow turns out to matter.
const MAX_RELATIONSHIPS_PER_CATEGORY = 10;

export interface LittleSisRelationshipEntry {
  fromName: string;
  fromType: "person" | "company";
  toName: string;
  toType: "person" | "company";
  relationshipType: string;
  role?: string; // description1, when LittleSis has one (e.g. "founder", "father")
  url: string;
}

/**
 * LittleSis entity/relationship page URLs are slugified as
 * "/{person|org}/{id}-{urlencoded name, spaces as underscores}", e.g.
 * "/person/462085-Terje_R%C3%B8d-Larsen". The relationships endpoint
 * never returns the related entity's name directly (only its numeric
 * id) — decoding it from this URL is free (no extra API call) and more
 * reliable than the free-text `description` sentence, which varies
 * per category and isn't safe to split on. The id prefix is always
 * purely numeric, so `^(\d+)-` unambiguously marks where the name
 * starts even when the name itself contains hyphens (e.g. "Rød-Larsen").
 */
function parseEntityFromUrl(url: string): { name: string; type: "person" | "company" } | null {
  const match = url.match(/littlesis\.org\/(person|org)\/(\d+)-(.+)$/);
  if (!match) return null;
  const [, kind, , slug] = match;
  const name = decodeURIComponent(slug).replace(/_/g, " ").trim();
  if (!name) return null;
  return { name, type: kind === "person" ? "person" : "company" };
}

export class LittleSisAgent {
  /**
   * @param entityTypeHint Disambiguates which search result counts as
   *   "the" matched entity when a name returns several — e.g. researching
   *   a person named the same as a well-known org. Prefers the first
   *   result whose primary_ext agrees with the hint, falling back to
   *   LittleSis's own top result (already relevance-ranked) if none
   *   match. Only affects which entity relationships get pulled for —
   *   `matches` below is unaffected and still lists everything found.
   * @param includeRelationships Charon/internal-tier only (see class doc
   *   comment) — also pulls and normalizes the matched entity's
   *   relationships for Knowledge Graph writing.
   */
  async run(
    name: string,
    entityTypeHint?: "person" | "company",
    includeRelationships = false
  ): Promise<{ matches: PowerMapEntry[]; relationships: LittleSisRelationshipEntry[]; sources: Source[] }> {
    try {
      const res = await fetch(
        `${LITTLESIS_BASE}/entities/search?q=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[littlesis-agent] "${name}" — HTTP ${res.status}`);
        return { matches: [], relationships: [], sources: [] };
      }

      const data = (await res.json()) as LittleSisSearchResponse;
      const rawResults = (data.data ?? []).filter((r) => r.attributes?.name);

      // Dedup Person-typed hits that are the same real individual under a
      // different LittleSis entity ID (e.g. "Charles Koch" / "Charles John
      // Koch" / "Charles G. Koch" — three records LittleSis has for one
      // person) down to one canonical record each, per
      // src/entity-validation.ts's mergeByKey. Org-typed hits, and any
      // Person hit that doesn't share a first+last name with another
      // (e.g. "Chase Koch" next to "Charles Koch" — a genuinely different
      // person, not a duplicate), pass through untouched. Richest-blurb
      // wins as canonical; first-occurrence order is preserved either way.
      const results = mergeByKey(
        rawResults,
        (r) => (r.attributes.primary_ext === "Person" ? `person:${personGroupKey(r.attributes.name)}` : `entity:${r.attributes.id}`),
        (a, b) => (a.attributes.blurb?.length ?? 0) > (b.attributes.blurb?.length ?? 0)
      );

      const matches: PowerMapEntry[] = results.slice(0, 8).map((r) => ({
        name: r.attributes.name,
        entityKind: r.attributes.primary_ext,
        blurb: r.attributes.blurb,
        url: `https://littlesis.org/entities/${r.attributes.id}`,
      }));

      const sources: Source[] = matches.length > 0
        ? [{
            url: `https://littlesis.org/search?q=${encodeURIComponent(name)}`,
            title: `LittleSis power-map search — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["power-map"],
          }]
        : [];

      console.log(`[littlesis-agent] "${name}" — ${matches.length} match(es)`);

      if (!includeRelationships || results.length === 0) {
        return { matches, relationships: [], sources };
      }

      const wantedExt = entityTypeHint === "person" ? "Person" : entityTypeHint === "company" ? "Org" : undefined;
      const primaryMatch =
        (wantedExt && results.find((r) => r.attributes.primary_ext === wantedExt)) ?? results[0];

      const relationships = await this.fetchRelationships(primaryMatch);
      return { matches, relationships, sources };
    } catch (err) {
      console.warn(`[littlesis-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { matches: [], relationships: [], sources: [] };
    }
  }

  private async fetchRelationships(entity: LittleSisEntity): Promise<LittleSisRelationshipEntry[]> {
    const primaryName = entity.attributes.name;
    const primaryType: "person" | "company" = entity.attributes.primary_ext === "Person" ? "person" : "company";

    const perCategory = await Promise.all(
      Object.entries(RELEVANT_CATEGORIES).map(async ([categoryId, relationshipType]) => {
        try {
          const res = await fetch(
            `${LITTLESIS_BASE}/entities/${entity.id}/relationships?category_id=${categoryId}`,
            { signal: AbortSignal.timeout(15_000) }
          );
          if (!res.ok) return [];

          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.includes("application/json")) {
            console.warn(`[littlesis-agent] relationships for entity ${entity.id}, category ${categoryId} — non-JSON response, skipping`);
            return [];
          }

          const data = (await res.json()) as LittleSisRelationshipsResponse;
          const records = (data.data ?? []).slice(0, MAX_RELATIONSHIPS_PER_CATEGORY);

          return records.flatMap((r): LittleSisRelationshipEntry[] => {
            const entity1 = parseEntityFromUrl(r.entity);
            const entity2 = parseEntityFromUrl(r.related);
            if (!entity1 || !entity2) return [];

            // One side is always the entity we already know by name —
            // use that exact name (avoids any slug-decoding drift on our
            // own match) rather than the freshly-parsed one.
            const from = r.attributes.entity1_id === entity.id ? { name: primaryName, type: primaryType } : entity1;
            const to = r.attributes.entity2_id === entity.id ? { name: primaryName, type: primaryType } : entity2;

            return [{
              fromName: from.name,
              fromType: from.type,
              toName: to.name,
              toType: to.type,
              relationshipType,
              role: r.attributes.description1?.trim() || undefined,
              url: `https://littlesis.org/relationships/${r.attributes.id}`,
            }];
          });
        } catch (err) {
          console.warn(`[littlesis-agent] relationships for entity ${entity.id}, category ${categoryId} — lookup failed:`, err instanceof Error ? err.message : err);
          return [];
        }
      })
    );

    const relationships = perCategory.flat();
    console.log(`[littlesis-agent] "${primaryName}" — ${relationships.length} relationship(s) for Knowledge Graph`);
    return relationships;
  }
}
