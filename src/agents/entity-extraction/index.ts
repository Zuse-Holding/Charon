import { z } from "zod";
import { extractStructured, extractViaOpenRouter } from "../../lib/llm.js";

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

const FactSchema = z.object({
  field: z.string(),
  value: z.string(),
  sourceUrl: z.string().optional(),
});

const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(["company", "person", "product"]),
  // Optional per-entity facts (e.g. {field: "ceo", value: "..."}) —
  // not yet populated by the extraction prompt below, but the knowledge
  // graph write layer (src/database/knowledge-graph.ts) already validates
  // and corrects these when present, so the shape is defined here now
  // rather than leaving it an implicit/untyped property.
  facts: z.array(FactSchema).optional(),
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
    primarySubject: { name: string; type: "company" | "person" | "product" | "political" }
  ): Promise<EntityExtractionResult> {
    const truncated = reportMarkdown.slice(0, 4000);

    // The knowledge graph's entity type only has three kinds (matches
    // the kg_entities DB CHECK constraint) — "political" isn't a graph
    // entity type, it's a research-run type. A politician is a person
    // for graph purposes. Confirmed in production: passing "political"
    // straight into the prompt as "(political)" got the LLM to echo
    // "political" back as an entity type, which the schema (rightly)
    // rejects, silently dropping every entity in that batch.
    const graphType = primarySubject.type === "political" ? "person" : primarySubject.type;

    // Use gpt-oss-120b via OpenRouter for better structured extraction
    // Falls back to Groq llama if OpenRouter key not set
    const GPT_OSS = "openai/gpt-oss-120b";
    const prompt = `You are extracting named entities and relationships from a business research report about "${primarySubject.name}" for a knowledge graph.

The primary subject is: "${primarySubject.name}" (${graphType})

Return JSON with:
- entities: array of {name, type} where type is "company", "person", or "product"
- relationships: array of {from, to, type} where from/to are exact entity names

ENTITY NAMING RULES — critical for deduplication:
- Use the shortest unambiguous name: "Model 3" not "Tesla Model 3", "iPhone 15" not "Apple iPhone 15"
- Company names: omit legal suffixes — "Tesla" not "Tesla, Inc.", "Apple" not "Apple Inc."
- People: use full name — "Elon Musk" not just "Musk"
- Never create two entries for the same entity with slightly different names

Relationship types: FOUNDED, CO_FOUNDED, CEO_OF, WORKS_AT, COMPETES_WITH, ACQUIRED, INVESTED_IN, PARTNERED_WITH, SUBSIDIARY_OF, MAKES

Always include "${primarySubject.name}" in entities. If it is a person, add CEO_OF or WORKS_AT relationships to their company. If it is a company, add FOUNDED or CEO_OF relationships to named founders/executives.`;

    // Try OpenRouter first, fall back to Groq
    let result = await extractViaOpenRouter(prompt, truncated, ExtractionResultSchema, GPT_OSS);
    if (!result) {
      result = await extractStructured(prompt, truncated, ExtractionResultSchema);
    }

    console.log(`[entity-extraction] ${primarySubject.name}: found ${result?.entities?.length ?? 0} entities, ${result?.relationships?.length ?? 0} relationships`);

    if (!result) {
      return {
        entities: [{ name: primarySubject.name, type: graphType }],
        relationships: [],
      };
    }

    // Normalize entity names to improve deduplication
    // - Strip parenthetical suffixes: "General Motors (GM)" → "General Motors"
    // - Strip common legal suffixes: "Tesla, Inc." → "Tesla"
    // - Filter product category suffixes: "Chevrolet Trucks" → skip
    const PRODUCT_CATEGORY_WORDS = new Set([
      "trucks", "suvs", "cars", "vans", "sedans", "crossovers", "vehicles",
      "phones", "laptops", "tablets", "products", "services", "solutions",
    ]);

  const PARENT_COMPANY_MAP: Record<string, string> = {
      "warner brothers": "Warner Bros. Discovery",
      "warner bros": "Warner Bros. Discovery",
      "warner bros.": "Warner Bros. Discovery",
      "instagram": "Meta",
      "whatsapp": "Meta",
      "youtube": "Google",
      "linkedin": "Microsoft",
      "github": "Microsoft",
      "activision": "Microsoft",
      "activision blizzard": "Microsoft",
      "20th century fox": "Disney",
      "20th century studios": "Disney",
      "abc": "Disney",
      "espn": "Disney",
      "marvel": "Disney",
      "pixar": "Disney",
      "lucasfilm": "Disney",
      "hulu": "Disney",
      "twitter": "X",
      "cnn": "Warner Bros. Discovery",
      "hbo": "Warner Bros. Discovery",
      "discovery channel": "Warner Bros. Discovery",
    };

    function normalizeName(name: string): string | null {
      let n = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
      n = n.replace(/,?\s*(Inc\.|LLC|Ltd\.|Corp\.|Co\.|Group)\.?$/i, "").trim();

      const lower = n.toLowerCase();
      if (PARENT_COMPANY_MAP[lower]) return PARENT_COMPANY_MAP[lower];

      const lastWord = n.split(" ").pop()?.toLowerCase() ?? "";
      if (PRODUCT_CATEGORY_WORDS.has(lastWord) && n.split(" ").length <= 3) return null;
      return n || null;
    }

    const hasPrimary = result.entities.some(
      (e) => e.name.toLowerCase() === primarySubject.name.toLowerCase()
    );

    const rawEntities = hasPrimary
      ? result.entities
      : [{ name: primarySubject.name, type: graphType }, ...result.entities];

    const entities = rawEntities
      .map(e => {
        const normalized = normalizeName(e.name);
        return normalized ? { ...e, name: normalized } : null;
      })
      .filter((e): e is typeof result.entities[0] => e !== null)
      .filter((e, i, arr) => arr.findIndex(x => x.name.toLowerCase() === e.name.toLowerCase()) === i);

   const entityNameSet = new Set(entities.map(e => e.name.toLowerCase()));

    const relationships = result.relationships
      .map(r => {
        const fromNorm = normalizeName(r.from) ?? r.from;
        const toNorm = normalizeName(r.to) ?? r.to;
        return { ...r, from: fromNorm, to: toNorm };
      })
      .filter(r => r.from.toLowerCase() !== r.to.toLowerCase())
      .filter(r =>
        entityNameSet.has(r.from.toLowerCase()) &&
        entityNameSet.has(r.to.toLowerCase())
      );

    return { entities, relationships };
  }
}
