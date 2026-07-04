import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

interface Entity {
  id: string;
  name: string;
  type: string;
}

interface Relationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: string;
}

interface PathStep {
  entity: Entity;
  viaRelationship?: string;
}

/**
 * Cross-entity query — finds the shortest path connecting two entities
 * through the knowledge graph using breadth-first search.
 * Max depth of 4 hops to keep queries fast and results meaningful.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const fromName = req.nextUrl.searchParams.get("from");
    const toName = req.nextUrl.searchParams.get("to");

    if (!fromName || !toName) {
      return NextResponse.json({ error: "from and to entity names required" }, { status: 400 });
    }

    // Load all entities and relationships for this user
    const [entitiesRes, relationshipsRes] = await Promise.all([
      supabase.from("kg_entities").select("id, name, type").eq("user_id", user.id),
      supabase.from("kg_relationships").select("id, from_entity_id, to_entity_id, relationship_type").eq("user_id", user.id),
    ]);

    const entities: Entity[] = entitiesRes.data ?? [];
    const relationships: Relationship[] = relationshipsRes.data ?? [];

    const fromEntity = entities.find(e => e.name.toLowerCase() === fromName.toLowerCase());
    const toEntity = entities.find(e => e.name.toLowerCase() === toName.toLowerCase());

    if (!fromEntity || !toEntity) {
      return NextResponse.json({
        found: false,
        message: `Could not find "${!fromEntity ? fromName : toName}" in your knowledge graph. Try researching it first.`,
      });
    }

    if (fromEntity.id === toEntity.id) {
      return NextResponse.json({
        found: false,
        message: "Please select two different entities.",
      });
    }

    // Build adjacency list (undirected — relationships work both ways for pathfinding)
    const adjacency = new Map<string, { entityId: string; relType: string }[]>();
    for (const rel of relationships) {
      if (!adjacency.has(rel.from_entity_id)) adjacency.set(rel.from_entity_id, []);
      if (!adjacency.has(rel.to_entity_id)) adjacency.set(rel.to_entity_id, []);
      adjacency.get(rel.from_entity_id)!.push({ entityId: rel.to_entity_id, relType: rel.relationship_type });
      adjacency.get(rel.to_entity_id)!.push({ entityId: rel.from_entity_id, relType: rel.relationship_type });
    }

    // BFS — find shortest path, max depth 4
    const MAX_DEPTH = 4;
    const visited = new Set<string>([fromEntity.id]);
    const queue: { entityId: string; path: PathStep[] }[] = [
      { entityId: fromEntity.id, path: [{ entity: fromEntity }] },
    ];

    let foundPath: PathStep[] | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > MAX_DEPTH + 1) continue;

      if (current.entityId === toEntity.id) {
        foundPath = current.path;
        break;
      }

      const neighbors = adjacency.get(current.entityId) ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.entityId)) continue;
        visited.add(neighbor.entityId);

        const neighborEntity = entities.find(e => e.id === neighbor.entityId);
        if (!neighborEntity) continue;

        const newPath = [...current.path];
        newPath[newPath.length - 1] = {
          ...newPath[newPath.length - 1],
          viaRelationship: neighbor.relType,
        };
        newPath.push({ entity: neighborEntity });

        queue.push({ entityId: neighbor.entityId, path: newPath });
      }
    }

    if (!foundPath) {
      return NextResponse.json({
        found: false,
        message: `No connection found between "${fromEntity.name}" and "${toEntity.name}" within ${MAX_DEPTH} hops. They may not be related in your research history yet.`,
      });
    }

    // Build human-readable path description
    const pathDescription = foundPath
      .map((step, i) => {
        if (i === foundPath!.length - 1) return step.entity.name;
        return `${step.entity.name} —${step.viaRelationship?.replace(/_/g, " ") ?? "connected to"}→ `;
      })
      .join("");

    return NextResponse.json({
      found: true,
      hops: foundPath.length - 1,
      path: foundPath.map(step => ({
        id: step.entity.id,
        name: step.entity.name,
        type: step.entity.type,
        viaRelationship: step.viaRelationship,
      })),
      description: pathDescription,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
