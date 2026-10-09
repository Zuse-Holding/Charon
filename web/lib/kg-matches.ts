import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pending possible matches (Feature 3) with the report each side came
 * from. A "same report" match is one where re-running a report created an
 * entity matching one from an earlier run of that same report: those are
 * the only ones "Merge all from this report" may merge.
 */

export interface RunInfo {
  id: string;
  subject: string;
  type: string;
  generatedAt: string;
}

export interface PendingMatch {
  id: string;
  entity_id: string | null;
  entity_name: string;
  candidate_id: string | null;
  candidate_name: string;
  reason: string;
  created_at: string;
  /** The run that created the newer entity, when this is a re-run of the
   *  same report as the candidate's run. */
  sameReportRun: RunInfo | null;
}

export async function loadPendingMatches(supabase: SupabaseClient, limit = 100): Promise<PendingMatch[]> {
  const { data: reviews, error } = await supabase
    .from("kg_match_reviews")
    .select("id, entity_id, entity_name, candidate_id, candidate_name, reason, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = reviews ?? [];

  const entityIds = [...new Set(rows.flatMap((r) => [r.entity_id, r.candidate_id]).filter(Boolean))] as string[];
  const runOfEntity = new Map<string, string>();
  if (entityIds.length > 0) {
    const { data, error: e } = await supabase.from("kg_entities").select("id, source_run_id").in("id", entityIds);
    if (e) throw e;
    for (const x of data ?? []) if (x.source_run_id) runOfEntity.set(x.id, x.source_run_id);
  }
  const runIds = [...new Set(runOfEntity.values())];
  const runs = new Map<string, RunInfo>();
  if (runIds.length > 0) {
    const { data, error: e } = await supabase.from("research_runs").select("id, subject, type, generated_at").in("id", runIds);
    if (e) throw e;
    for (const r of data ?? []) runs.set(r.id, { id: r.id, subject: r.subject, type: r.type, generatedAt: r.generated_at });
  }

  return rows.map((r) => {
    const newer = r.entity_id ? runs.get(runOfEntity.get(r.entity_id) ?? "") : undefined;
    const older = r.candidate_id ? runs.get(runOfEntity.get(r.candidate_id) ?? "") : undefined;
    const same = !!newer && !!older && newer.id !== older.id && newer.type === older.type
      && newer.subject.trim().toLowerCase() === older.subject.trim().toLowerCase();
    return { ...r, sameReportRun: same ? newer! : null };
  });
}
