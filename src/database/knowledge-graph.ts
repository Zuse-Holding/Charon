import { createClient } from "@supabase/supabase-js";
import { EntityExtractionResult } from "../agents/entity-extraction/index.js";

/**
 * Knowledge Graph data layer (Phase 1).
 * Writes extracted entities and relationships to Supabase using the
 * service role key — this runs server-side (VPS agent server) after
 * each research run completes, never from the browser.
 *
 * Entity dedup is handled via the UNIQUE (user_id, name, type) constraint
 * on kg_entities — repeated mentions of "Stripe" across multiple research
 * runs collapse into a single entity row, with relationships accumulating
 * over time as more runs reference it.
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

  // Upsert entities — UNIQUE(user_id, name, type) means repeated names
  // resolve to the same row instead of duplicating.
  const entityIdMap = new Map<string, string>(); // name (lowercase) -> id

  for (const entity of extraction.entities) {
    const { data, error } = await supabase
      .from("kg_entities")
      .upsert(
        {
          user_id: userId,
          name: entity.name,
          type: entity.type,
          source_run_id: sourceRunId,
        },
        { onConflict: "user_id,name,type", ignoreDuplicates: false }
      )
      .select("id, name")
      .single();

    if (!error && data) {
      entityIdMap.set(entity.name.toLowerCase(), data.id);
    }
  }

  // Insert relationships — only for entity pairs we successfully resolved
  const relationshipRows = extraction.relationships
    .map((rel) => {
      const fromId = entityIdMap.get(rel.from.toLowerCase());
      const toId = entityIdMap.get(rel.to.toLowerCase());
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
