import { z } from "zod";
import { extractStructured } from "../../lib/llm.js";

/**
 * Entity Extraction Agent (Knowledge Graph — Phase 1)
 *
 * Runs after a research report is generated. Reads the finished markdown
 * and extracts named entities (companies, people, products) plus the
 * relationships between them (FOUNDED, COMPETES_WITH, ACQUIRED, etc).
 *
 * This is purely a data-collection pass right now — no UI consumes this
 * yet. The goal is to start accumulating real relationship data so that
 * when the graph visualization (Phase 2+) is built, there's already a
 * meaningful dataset rather than starting from zero.
 *
 * Designed to fail silently — if extraction fails for any reason, the
 * research run itself is unaffected. This is a best-effort enrichment
 * step, not a critical path.
 */

const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(["company", "person", "product"]),
});

const RelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(), // e.g. FOUNDED, COMPETES_WITH, ACQUIRED, PARTNERED_WITH, WORKS_AT, INVESTED_IN
});

const ExtractionResultSchema = z.object({
  entities: z.array(EntitySchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
});

export type ExtractedEntity = z.infer<typeof EntitySchema>;
export type ExtractedRelationship = z.infer<typeof RelationshipSchema>;
export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export class EntityExtractionAgent {
  async extract(
    reportMarkdown: string,
    primarySubject: { name: string; type: "company" | "person" | "product" }
  ): Promise<EntityExtractionResult> {
    const truncated = reportMarkdown.slice(0, 4000);

    const result = await extractStructured(
      `You are extracting named entities and relationships from a business research report about "${primarySubject.name}" for a knowledge graph.

The primary subject is: "${primarySubject.name}" (${primarySubject.type})

Return JSON with:
- entities: array of {name, type} where type is "company", "person", or "product"
- relationships: array of {from, to, type} where from/to are exact entity names

ENTITY NAMING RULES — critical for deduplication:
- Use the shortest unambiguous name: "Model 3" not "Tesla Model 3", "iPhone 15" not "Apple iPhone 15"
- Company names: omit legal suffixes — "Tesla" not "Tesla, Inc.", "Apple" not "Apple Inc."
- People: use full name — "Elon Musk" not just "Musk"
- Never create two entries for the same entity with slightly different names

Relationship types: FOUNDED, CO_FOUNDED, CEO_OF, WORKS_AT, COMPETES_WITH, ACQUIRED, INVESTED_IN, PARTNERED_WITH, SUBSIDIARY_OF, MAKES

Always include "${primarySubject.name}" in entities. If it is a person, add CEO_OF or WORKS_AT relationships to their company. If it is a company, add FOUNDED or CEO_OF relationships to named founders/executives.`,
      truncated,
      ExtractionResultSchema
    );

    console.log(`[entity-extraction] ${primarySubject.name}: found ${result?.entities?.length ?? 0} entities, ${result?.relationships?.length ?? 0} relationships`);

    if (!result) {
      return {
        entities: [{ name: primarySubject.name, type: primarySubject.type }],
        relationships: [],
      };
    }

    // Ensure primary subject is always included
    const hasPrimary = result.entities.some(
      (e) => e.name.toLowerCase() === primarySubject.name.toLowerCase()
    );
    const entities = hasPrimary
      ? result.entities
      : [{ name: primarySubject.name, type: primarySubject.type }, ...result.entities];

    return { entities, relationships: result.relationships };
  }
}
