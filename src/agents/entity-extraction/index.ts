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
- entities: every named company, person, or product mentioned (specific proper nouns only)
- relationships: connections between entities

Relationship types to look for:
- FOUNDED / CO_FOUNDED — person founded a company
- WORKS_AT / WORKED_AT — person works or worked at a company  
- COMPETES_WITH — two companies compete directly
- ACQUIRED — one company bought another
- INVESTED_IN — investor put money into a company
- PARTNERED_WITH — formal partnership between entities
- SUBSIDIARY_OF — one company is owned by another
- USES — company or person uses a product/service

Rules:
- Be LIBERAL about extracting relationships — if the text implies a connection, include it
- The "from" and "to" fields must match entity names exactly as listed in your entities array
- Include the primary subject of this report as an entity even if obvious
- Aim for 3-8 relationships if the data supports it`,
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
