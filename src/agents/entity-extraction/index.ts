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
  /**
   * Extracts entities and relationships from a finished report.
   * `primarySubject` is the name/type of the thing that was researched —
   * always included as an entity even if the LLM extraction misses it,
   * since it's the one entity we're 100% certain exists.
   */
  async extract(
    reportMarkdown: string,
    primarySubject: { name: string; type: "company" | "person" | "product" }
  ): Promise<EntityExtractionResult> {
    // Truncate — entity extraction doesn't need the full report, and
    // keeping this pass cheap matters since it runs on every research run.
    const truncated = reportMarkdown.slice(0, 4000);

    const result = await extractStructured(
      `You are extracting named entities and relationships from a business research report for a knowledge graph.

Extract:
- entities: every named company, person, or product mentioned (not generic terms — only specific proper nouns)
- relationships: connections between entities, using types like FOUNDED, CO_FOUNDED, COMPETES_WITH, ACQUIRED, PARTNERED_WITH, WORKS_AT, INVESTED_IN, SUBSIDIARY_OF

Rules:
- Only extract entities that are clearly named (not "the company" or "a competitor")
- Relationships must reference entities you've also extracted in the entities array
- Be conservative — only extract relationships explicitly stated or strongly implied in the text
- The "from" and "to" fields in relationships should match entity names exactly`,
      truncated,
      ExtractionResultSchema
    );

    if (!result) {
      // LLM unavailable — return just the primary subject as a fallback
      // so the graph at least has the entity even without relationships.
      return {
        entities: [{ name: primarySubject.name, type: primarySubject.type }],
        relationships: [],
      };
    }

    // Ensure the primary subject is always included
    const hasPrimary = result.entities.some(
      (e) => e.name.toLowerCase() === primarySubject.name.toLowerCase()
    );
    const entities = hasPrimary
      ? result.entities
      : [{ name: primarySubject.name, type: primarySubject.type }, ...result.entities];

    return { entities, relationships: result.relationships };
  }
}
