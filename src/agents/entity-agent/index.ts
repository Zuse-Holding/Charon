import { z } from "zod";
import { extractStructured } from "../../lib/llm.js";
import { ResearchBundle } from "../../types/research.js";

/**
 * Entity Agent
 *
 * Reads a ResearchBundle and uses Groq to extract all named entities
 * and the relationships between them. Output feeds the Knowledge Graph.
 *
 * Entity types: company | person | investor | product | location
 *
 * Relationship types (canonical strings):
 *   FOUNDED_BY   — company → person
 *   WORKS_AT     — person → company
 *   INVESTED_IN  — investor → company
 *   COMPETES_WITH — company → company
 *   ACQUIRED_BY  — company → company
 *   PARTNERS_WITH — company → company
 *   LOCATED_IN   — entity → location
 *   PART_OF      — entity → company (subsidiary/division)
 */

export type EntityType = "company" | "person" | "investor" | "product" | "location";

export interface ExtractedEntity {
  id: string;         // slugified name, used as graph node id
  name: string;
  type: EntityType;
  properties?: Record<string, string>;
}

export interface ExtractedRelationship {
  source: string;     // entity id
  target: string;     // entity id
  type: string;       // e.g. FOUNDED_BY
  label?: string;     // human-readable label
}

export interface EntityGraph {
  id: string;
  subject: string;
  generatedAt: string;
  runId?: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// ── Zod Schema ──────────────────────────────────────────────────────────
const AnyObject = z.record(z.string(), z.unknown());

const VALID_ENTITY_TYPES: EntityType[] = [
  "company", "person", "investor", "product", "location",
];

const VALID_REL_TYPES = [
  "FOUNDED_BY", "WORKS_AT", "INVESTED_IN", "COMPETES_WITH",
  "ACQUIRED_BY", "PARTNERS_WITH", "LOCATED_IN", "PART_OF",
  "RELATED_TO",
];

export const EntityGraphSchema = AnyObject.transform((obj) => {
  const rawEntities = Array.isArray(obj.entities) ? obj.entities : [];
  const rawRels = Array.isArray(obj.relationships) ? obj.relationships : [];

  const entities: ExtractedEntity[] = rawEntities
    .map((e: unknown) => {
      const item = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
      const name = String(item.name ?? "").trim();
      const type = VALID_ENTITY_TYPES.includes(String(item.type) as EntityType)
        ? (String(item.type) as EntityType)
        : "company";
      if (!name) return null;
      return {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name,
        type,
        properties: typeof item.properties === "object" && item.properties !== null
          ? Object.fromEntries(
              Object.entries(item.properties as Record<string, unknown>).map(
                ([k, v]) => [k, String(v)]
              )
            )
          : {},
      };
    })
    .filter((e): e is ExtractedEntity => e !== null);

  const entityIds = new Set(entities.map((e) => e.id));

  const relationships: ExtractedRelationship[] = rawRels
    .map((r: unknown) => {
      const item = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
      const sourceName = String(item.source ?? "").trim();
      const targetName = String(item.target ?? "").trim();
      const sourceId = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const targetId = targetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const relType = VALID_REL_TYPES.includes(String(item.type))
        ? String(item.type)
        : "RELATED_TO";
      if (!sourceId || !targetId) return null;
      // Only keep relationships where both entities were extracted
      if (!entityIds.has(sourceId) || !entityIds.has(targetId)) return null;
      return {
        source: sourceId,
        target: targetId,
        type: relType,
        label: item.label ? String(item.label) : relType.replace(/_/g, " "),
      };
    })
    .filter((r): r is ExtractedRelationship => r !== null);

  return { entities, relationships };
});

// ── Agent ───────────────────────────────────────────────────────────────
export class EntityAgent {
  async run(bundle: ResearchBundle): Promise<Omit<EntityGraph, "id" | "generatedAt">> {
    const context = this.buildContext(bundle);

    const SYSTEM = `You are an entity and relationship extraction specialist.
Extract ALL named entities from the research data and map the relationships between them.

Entity types (use exactly these strings):
  company   — any business, startup, or organization
  person    — any named individual
  investor  — VC firm, angel, or investment fund
  product   — specific product or service offering
  location  — city, country, or region

Relationship types (use exactly these strings):
  FOUNDED_BY    — company was founded by person
  WORKS_AT      — person works or worked at company
  INVESTED_IN   — investor funded company
  COMPETES_WITH — company competes with company
  ACQUIRED_BY   — company was acquired by company
  PARTNERS_WITH — company partners with company
  LOCATED_IN    — entity is located in location
  PART_OF       — entity is subsidiary or division of company
  RELATED_TO    — generic fallback

Rules:
- Only include entities explicitly mentioned in the data
- For relationships, use the entity NAME exactly as it appears in your entities list
- Deduplicate: if the same entity appears multiple times, list it once
- Include the main company being researched as an entity of type "company"
- Respond with ONLY valid JSON, no other text`;

    const result = await extractStructured(SYSTEM, context, EntityGraphSchema);

    if (!result) {
      // Fallback: build a minimal graph from structured bundle fields
      return this.fallbackExtraction(bundle);
    }

    return {
      subject: bundle.query,
      entities: result.entities,
      relationships: result.relationships,
    };
  }

  private buildContext(bundle: ResearchBundle): string {
    const parts: string[] = [];
    parts.push(`Company: ${bundle.company.name}`);
    if (bundle.company.description) parts.push(`Description: ${bundle.company.description}`);
    if (bundle.company.headquarters) parts.push(`HQ: ${bundle.company.headquarters}`);
    if (bundle.company.industry) parts.push(`Industry: ${bundle.company.industry}`);
    if (bundle.ownership) parts.push(`Ownership: ${bundle.ownership}`);

    if (bundle.leadership.length) {
      parts.push(`\nLeadership:`);
      bundle.leadership.forEach((l) => parts.push(`  - ${l.name} (${l.title})`));
    }

    if (bundle.funding.length) {
      parts.push(`\nFunding:`);
      bundle.funding.forEach((f) => {
        const investors = f.investors?.join(", ") ?? "";
        parts.push(`  - ${f.round ?? "Round"}: ${f.amount ?? "undisclosed"}${investors ? ` from ${investors}` : ""}`);
      });
    }

    if (bundle.competitors.length) {
      parts.push(`\nCompetitors: ${bundle.competitors.map((c) => c.name).join(", ")}`);
    }

    if (bundle.news.length) {
      parts.push(`\nRecent news headlines:`);
      bundle.news.slice(0, 5).forEach((n) => parts.push(`  - ${n.headline}`));
    }

    if (bundle.risks?.length) {
      parts.push(`\nRisks: ${bundle.risks.slice(0, 3).join("; ")}`);
    }

    return parts.join("\n");
  }

  private fallbackExtraction(bundle: ResearchBundle): Omit<EntityGraph, "id" | "generatedAt"> {
    const entities: ExtractedEntity[] = [];
    const relationships: ExtractedRelationship[] = [];

    const toId = (name: string) =>
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Main company
    const companyId = toId(bundle.company.name);
    entities.push({ id: companyId, name: bundle.company.name, type: "company" });

    if (bundle.company.headquarters) {
      const locId = toId(bundle.company.headquarters);
      entities.push({ id: locId, name: bundle.company.headquarters, type: "location" });
      relationships.push({ source: companyId, target: locId, type: "LOCATED_IN", label: "located in" });
    }

    for (const l of bundle.leadership) {
      const pid = toId(l.name);
      entities.push({ id: pid, name: l.name, type: "person", properties: { title: l.title } });
      relationships.push({ source: pid, target: companyId, type: "WORKS_AT", label: l.title });
    }

    for (const f of bundle.funding) {
      for (const inv of f.investors ?? []) {
        const invId = toId(inv);
        entities.push({ id: invId, name: inv, type: "investor" });
        relationships.push({ source: invId, target: companyId, type: "INVESTED_IN", label: f.round ?? "invested" });
      }
    }

    for (const c of bundle.competitors) {
      const cId = toId(c.name);
      entities.push({ id: cId, name: c.name, type: "company" });
      relationships.push({ source: companyId, target: cId, type: "COMPETES_WITH", label: "competes with" });
    }

    // Deduplicate entities by id
    const seen = new Set<string>();
    const dedupedEntities = entities.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return { subject: bundle.query, entities: dedupedEntities, relationships };
  }
}
