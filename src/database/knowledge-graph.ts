import { EntityExtractionResult } from "../agents/entity-extraction/index.js";
import { LittleSisRelationshipEntry } from "../agents/littlesis-agent/index.js";
import { validateAndCorrectFact, findOverride } from "../entity-validation.js";
import { isEnabled } from "../lib/flags.js";
import { normalizeName } from "../lib/entities/normalize.js";
import { resolve, type EntityType, type KnownEntity } from "../lib/entities/resolve.js";
import type { IdentifiedRecord } from "../lib/entities/records.js";
import { SupabaseKgStore, type KgStore, type RelationshipRow, type ReviewRow } from "./kg-store.js";

/**
 * Knowledge Graph data layer.
 * Writes extracted entities and relationships to Supabase using the
 * service role key — runs server-side after each research run completes.
 *
 * Flag off: entities dedupe on exact (name, type), as they always have.
 * Flag on (FEATURE_ENTITY_RESOLUTION, Feature 3): entities merge only on
 * a shared hard identifier. A name match creates a separate entity plus a
 * "possible match" for the user to confirm or reject (see
 * src/lib/entities/resolve.ts).
 *
 * Includes entity validation layer to catch LLM extraction errors
 * (e.g. org name returned instead of CEO name).
 */

export interface SaveOptions {
  /** Records carrying hard identifiers (records.ts). Used with the flag on. */
  records?: IdentifiedRecord[];
  /** The run's research subject, linked to each of its records. */
  subject?: { name: string; type: string };
  /** Defaults to Supabase with the service-role key. */
  store?: KgStore;
  /** Defaults to the FEATURE_ENTITY_RESOLUTION flag. */
  resolution?: boolean;
}

export async function saveEntityExtraction(
  userId: string,
  sourceRunId: string,
  extraction: EntityExtractionResult,
  options: SaveOptions = {},
): Promise<void> {
  const store = options.store ?? SupabaseKgStore.fromEnv();
  const resolution = options.resolution ?? isEnabled("entity_resolution");

  const entityIdMap = new Map<string, string>(); // name (lowercase) -> id
  const known: KnownEntity[] = resolution ? await store.listKnown(userId) : [];
  const reviews: ReviewRow[] = [];

  async function create(name: string, type: EntityType, r: { possibleMatches: string[]; distinctFrom: string[] }) {
    const id = await store.insertEntity(userId, name, type, sourceRunId);
    const nameOf = (other: string) => known.find((k) => k.id === other)?.name ?? "";
    for (const other of r.possibleMatches) {
      reviews.push({ entityId: id, entityName: name, candidateId: other, candidateName: nameOf(other), status: "pending", reason: "name_only" });
    }
    for (const other of r.distinctFrom) {
      reviews.push({ entityId: id, entityName: name, candidateId: other, candidateName: nameOf(other), status: "distinct", reason: "conflicting_identifiers" });
    }
    known.push({ id, name, type, identifiers: [] });
    return id;
  }

  // Records with hard identifiers first: each is an entity of its own,
  // found again later only by its identifier.
  const recordIds = new Map<string, string[]>(); // type|normalized name -> entity ids
  const recordLinks: { id: string; relationship?: string }[] = [];
  if (resolution) {
    for (const rec of options.records ?? []) {
      try {
        const r = resolve(rec, known);
        const id = r.action === "use" ? r.entityId : await create(rec.name, rec.type, r);
        if (r.action === "use") await store.touchEntity(id, sourceRunId);
        await store.addIdentifiers(userId, id, rec.identifiers, sourceRunId);
        known.find((k) => k.id === id)!.identifiers.push(...rec.identifiers.map(({ kind, issuer, value }) => ({ kind, issuer, value })));
        const key = `${rec.type}|${normalizeName(rec.name, rec.type)}`;
        const ids = recordIds.get(key) ?? [];
        if (!ids.includes(id)) recordIds.set(key, [...ids, id]);
        recordLinks.push({ id, relationship: rec.relationship });
      } catch (err) {
        console.error(`[knowledge-graph] record "${rec.name}" not saved:`, err instanceof Error ? err.message : err);
      }
    }
  }

  for (const entity of extraction.entities) {
    // Look up any known override for this entity before writing
    const override = findOverride(entity.name);

    // Validate and correct any person-field facts before they hit the DB
    if (entity.facts) {
      entity.facts = entity.facts.map((fact) => {
        const result = validateAndCorrectFact(entity.name, fact, override);
        if (result.flagged) {
          console.warn(
            `[knowledge-graph] Corrected fact on "${entity.name}": ${result.note}`
          );
        }
        return { ...fact, value: result.value };
      });
    }

    // Use canonical name if we have an override
    const canonicalName = override?.canonical_name ?? entity.name;

    let id: string | undefined;
    try {
      if (!resolution) {
        id = await store.findByName(userId, canonicalName, entity.type);
        if (id) await store.touchEntity(id, sourceRunId);
        else id = await store.insertEntity(userId, canonicalName, entity.type, sourceRunId);
      } else {
        // This report's mention of a record this report also found is that
        // record. With two same-named records the mention can't say which,
        // so it stays separate, as a possible match to both.
        const fromRecords = recordIds.get(`${entity.type}|${normalizeName(canonicalName, entity.type)}`);
        if (fromRecords?.length === 1) {
          id = fromRecords[0];
        } else {
          const r = resolve({ name: canonicalName, type: entity.type, identifiers: [] }, known);
          id = r.action === "use" ? r.entityId : await create(canonicalName, entity.type, r);
        }
      }
    } catch (err) {
      console.error(`[knowledge-graph] entity "${canonicalName}" not saved:`, err instanceof Error ? err.message : err);
    }

    if (id) {
      // Map both the raw extracted name and canonical name for relationship resolution
      entityIdMap.set(entity.name.toLowerCase(), id);
      entityIdMap.set(canonicalName.toLowerCase(), id);

      // Also map known aliases so relationships resolve correctly
      if (override?.aka) {
        for (const alias of override.aka) {
          entityIdMap.set(alias.toLowerCase(), id);
        }
      }
    }
  }

  await store.addReviews(userId, reviews);

  // Insert relationships — only for entity pairs we successfully resolved
  const relationshipRows: RelationshipRow[] = extraction.relationships
    .map((rel) => {
      const fromId = entityIdMap.get(rel.from.toLowerCase());
      const toId   = entityIdMap.get(rel.to.toLowerCase());
      if (!fromId || !toId) return null;
      return { fromId, toId, type: rel.type };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // The subject's link to each identified record its report found.
  const subjectId = options.subject ? entityIdMap.get(options.subject.name.toLowerCase()) : undefined;
  if (subjectId) {
    for (const link of recordLinks) {
      if (link.id !== subjectId && link.relationship) relationshipRows.push({ fromId: subjectId, toId: link.id, type: link.relationship });
    }
  }

  await store.insertRelationships(userId, sourceRunId, relationshipRows);
}

/**
 * Writes LittleSis relationships (board/officer positions, memberships,
 * family ties, donations, ownership — see src/agents/littlesis-agent) as
 * real Knowledge Graph edges, not just report text. Reuses
 * saveEntityExtraction's upsert/dedup/override-canonicalization logic
 * rather than duplicating it — LittleSis relationships are just another
 * source of {entities, relationships} pairs, same shape the LLM
 * extraction pass already produces from report prose.
 */
export async function saveLittleSisRelationships(
  userId: string,
  sourceRunId: string,
  relationships: LittleSisRelationshipEntry[]
): Promise<void> {
  if (relationships.length === 0) return;

  const entityMap = new Map<string, "company" | "person">();
  for (const rel of relationships) {
    entityMap.set(rel.fromName, rel.fromType);
    entityMap.set(rel.toName, rel.toType);
  }

  const extraction: EntityExtractionResult = {
    entities: [...entityMap.entries()].map(([name, type]) => ({ name, type })),
    relationships: relationships.map((rel) => ({
      from: rel.fromName,
      to: rel.toName,
      type: rel.role ? `${rel.relationshipType} (${rel.role})` : rel.relationshipType,
    })),
  };

  await saveEntityExtraction(userId, sourceRunId, extraction);
}
