import { createClient } from "@supabase/supabase-js";
import { EntityExtractionResult } from "../agents/entity-extraction/index.js";
import { LittleSisRelationshipEntry } from "../agents/littlesis-agent/index.js";
import { validateAndCorrectFact, findOverride } from "../entity-validation.js";

/**
 * Knowledge Graph data layer.
 * Writes extracted entities and relationships to Supabase using the
 * service role key — runs server-side after each research run completes.
 *
 * Entity dedup via UNIQUE(user_id, name, type) constraint — repeated mentions
 * of "Stripe" across runs collapse into a single entity row.
 *
 * Includes entity validation layer to catch LLM extraction errors
 * (e.g. org name returned instead of CEO name).
 */

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase credentials missing for knowledge graph write");
  }
  return createClient(url, key);
}

export async function saveEntityExtraction(
  userId: string,
  sourceRunId: string,
  extraction: EntityExtractionResult
): Promise<void> {
  const supabase = getClient();

  const entityIdMap = new Map<string, string>(); // name (lowercase) -> id

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

    const { data, error } = await supabase
      .from("kg_entities")
      .upsert(
        {
          user_id: userId,
          name: canonicalName,
          type: entity.type,
          source_run_id: sourceRunId,
        },
        { onConflict: "user_id,name,type", ignoreDuplicates: false }
      )
      .select("id, name")
      .single();

    if (!error && data) {
      // Map both the raw extracted name and canonical name for relationship resolution
      entityIdMap.set(entity.name.toLowerCase(), data.id);
      entityIdMap.set(canonicalName.toLowerCase(), data.id);

      // Also map known aliases so relationships resolve correctly
      if (override?.aka) {
        for (const alias of override.aka) {
          entityIdMap.set(alias.toLowerCase(), data.id);
        }
      }
    }
  }

  // Insert relationships — only for entity pairs we successfully resolved
  const relationshipRows = extraction.relationships
    .map((rel) => {
      const fromId = entityIdMap.get(rel.from.toLowerCase());
      const toId   = entityIdMap.get(rel.to.toLowerCase());
      if (!fromId || !toId) return null;
      return {
        user_id: userId,
        from_entity_id: fromId,
        to_entity_id: toId,
        relationship_type: rel.type,
        source_run_id: sourceRunId,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (relationshipRows.length > 0) {
    await supabase.from("kg_relationships").insert(relationshipRows);
  }
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
