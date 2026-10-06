import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EntityType, Identifier, KnownEntity } from "../lib/entities/resolve.js";

/**
 * Storage for Knowledge Graph writes. An interface so the resolution
 * logic in knowledge-graph.ts runs against an in-memory store in tests.
 */

export interface RelationshipRow {
  fromId: string;
  toId: string;
  type: string;
}

export interface ReviewRow {
  /** The newer entity, created by this run. */
  entityId: string;
  entityName: string;
  /** The existing entity it may be (or is distinct from). */
  candidateId: string;
  candidateName: string;
  status: "pending" | "distinct";
  reason: "name_only" | "conflicting_identifiers";
}

export interface KgStore {
  /** Legacy (flag off): the entity with exactly this name and type. */
  findByName(userId: string, name: string, type: EntityType): Promise<string | undefined>;
  /** Every entity the user has, with its identifiers. */
  listKnown(userId: string): Promise<KnownEntity[]>;
  insertEntity(userId: string, name: string, type: EntityType, runId: string): Promise<string>;
  touchEntity(entityId: string, runId: string): Promise<void>;
  addIdentifiers(userId: string, entityId: string, ids: Identifier[], runId: string): Promise<void>;
  addReviews(userId: string, rows: ReviewRow[]): Promise<void>;
  insertRelationships(userId: string, runId: string, rows: RelationshipRow[]): Promise<void>;
}

export class SupabaseKgStore implements KgStore {
  constructor(private db: SupabaseClient) {}

  static fromEnv(): SupabaseKgStore {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase credentials missing for knowledge graph write");
    return new SupabaseKgStore(createClient(url, key));
  }

  async findByName(userId: string, name: string, type: EntityType) {
    const { data, error } = await this.db.from("kg_entities").select("id")
      .eq("user_id", userId).eq("name", name).eq("type", type).limit(1);
    if (error) throw error;
    return data?.[0]?.id as string | undefined;
  }

  async listKnown(userId: string): Promise<KnownEntity[]> {
    const [entities, ids] = await Promise.all([
      this.db.from("kg_entities").select("id, name, type").eq("user_id", userId).limit(10000),
      this.db.from("kg_entity_identifiers").select("entity_id, kind, issuer, value").eq("user_id", userId).limit(20000),
    ]);
    if (entities.error) throw entities.error;
    if (ids.error) throw ids.error;
    const byEntity = new Map<string, KnownEntity["identifiers"]>();
    for (const i of ids.data ?? []) {
      const list = byEntity.get(i.entity_id) ?? [];
      list.push({ kind: i.kind, issuer: i.issuer, value: i.value });
      byEntity.set(i.entity_id, list);
    }
    return (entities.data ?? []).map((e) => ({ id: e.id, name: e.name, type: e.type, identifiers: byEntity.get(e.id) ?? [] }));
  }

  async insertEntity(userId: string, name: string, type: EntityType, runId: string) {
    const { data, error } = await this.db.from("kg_entities")
      .insert({ user_id: userId, name, type, source_run_id: runId }).select("id").single();
    if (error) {
      // Legacy constraint still in place (migration not run yet) and a
      // concurrent write got there first: use that row.
      const existing = await this.findByName(userId, name, type);
      if (existing) return existing;
      throw error;
    }
    return data.id as string;
  }

  async touchEntity(entityId: string, runId: string) {
    const { error } = await this.db.from("kg_entities").update({ source_run_id: runId }).eq("id", entityId);
    if (error) throw error;
  }

  async addIdentifiers(userId: string, entityId: string, ids: Identifier[], runId: string) {
    if (ids.length === 0) return;
    const { error } = await this.db.from("kg_entity_identifiers").upsert(
      ids.map((i) => ({
        user_id: userId, entity_id: entityId, kind: i.kind, issuer: i.issuer, value: i.value,
        source_name: i.sourceName, source_url: i.sourceUrl, retrieved_at: i.retrievedAt, source_run_id: runId,
      })),
      { onConflict: "user_id,kind,issuer,value", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async addReviews(userId: string, rows: ReviewRow[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("kg_match_reviews").upsert(
      rows.map((r) => ({
        user_id: userId, entity_id: r.entityId, entity_name: r.entityName, candidate_id: r.candidateId,
        candidate_name: r.candidateName, status: r.status, reason: r.reason,
      })),
      { onConflict: "entity_id,candidate_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async insertRelationships(userId: string, runId: string, rows: RelationshipRow[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("kg_relationships").insert(rows.map((r) => ({
      user_id: userId, from_entity_id: r.fromId, to_entity_id: r.toId, relationship_type: r.type, source_run_id: runId,
    })));
    if (error) throw error;
  }
}
