import { createServerSupabaseClient } from "./server";

/**
 * Supabase-backed data layer for the web app.
 * Mirrors the function signatures from src/database/store.ts so
 * API routes can swap between them with minimal changes.
 * All operations are scoped to the authenticated user via RLS.
 */

// --- Research runs ---

export async function getAllRunsForUser() {
  const supabase = await createServerSupabaseClient();
  // Completed only — a run still in progress (status: 'pending') has no
  // report yet and would break anything here that assumes reportPath/
  // bundle are populated. Callers that need to know about an in-progress
  // run should use getPendingRunForUser() instead.
  const { data, error } = await supabase
    .from("research_runs")
    .select("*")
    .eq("status", "completed")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeRun);
}

// Background-persistent search — the most recent run still in flight for
// this user, if any. Lets the client detect and resume showing progress
// after a reload or in a fresh tab, since the research itself keeps
// running server-side independent of any one client connection.
export async function getPendingRunForUser() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("research_runs")
    .select("id, type, subject, generated_at")
    .eq("status", "pending")
    .order("generated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id as string,
    type: row.type as string,
    subject: row.subject as string,
    generatedAt: row.generated_at as string,
  };
}

export async function recordRunForUser(run: {
  id: string;
  type: string;
  subject: string;
  generatedAt: string;
  reportPath: string;
  bundle: unknown;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("research_runs").insert({
    id: run.id,
    user_id: user.id,
    type: run.type,
    subject: run.subject,
    generated_at: run.generatedAt,
    report_path: run.reportPath,
    bundle: run.bundle,
  });
  if (error) throw error;
}

export async function deleteRunForUser(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Cascade into the Knowledge Graph — previously the DB's
  // ON DELETE SET NULL on kg_entities/kg_relationships.source_run_id just
  // orphaned those rows (nulled the reference, left the entity dangling
  // forever with no run attribution) rather than actually removing them.
  // Entities upsert on (user_id, name, type), overwriting source_run_id
  // to whichever run most recently mentioned them — so deleting only
  // rows whose source_run_id still points at *this* run correctly leaves
  // alone any entity that's been re-mentioned in a later run since.
  // Relationships aren't upserted (a fresh row per run), so this is a
  // direct match on this run specifically, no cross-run risk there.
  await supabase.from("kg_relationships").delete().eq("user_id", user.id).eq("source_run_id", id);
  await supabase.from("kg_entities").delete().eq("user_id", user.id).eq("source_run_id", id);

  const { error } = await supabase
    .from("research_runs")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

function normalizeRun(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    type: row.type as string,
    subject: row.subject as string,
    generatedAt: row.generated_at as string,
    reportPath: row.report_path as string,
    bundle: row.bundle,
  };
}

// --- Watchlist ---

export async function getWatchlistForUser() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .order("added_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];

  // Creator rows get a bot/trajectory signal, sourced from
  // creator_snapshots (creator-snapshot-agent) — everything else (company/
  // person/product) has no such pipeline, so this is skipped entirely
  // unless there's at least one tracked creator.
  const creatorIds = rows.filter((r) => r.type === "creator").map((r) => r.id as string);
  const latestByCreator = new Map<string, { botScore: number | null; followerCount: number | null; snapshotDate: string }>();
  const snapshotCountByCreator = new Map<string, number>();

  if (creatorIds.length > 0) {
    const { data: snapshots } = await supabase
      .from("creator_snapshots")
      .select("creator_id, snapshot_date, bot_score, follower_count")
      .in("creator_id", creatorIds)
      .order("snapshot_date", { ascending: false });

    for (const s of snapshots ?? []) {
      const creatorId = s.creator_id as string;
      snapshotCountByCreator.set(creatorId, (snapshotCountByCreator.get(creatorId) ?? 0) + 1);
      // Rows arrive newest-first, so the first one seen per creator is its latest.
      if (!latestByCreator.has(creatorId)) {
        latestByCreator.set(creatorId, {
          botScore: s.bot_score as number | null,
          followerCount: s.follower_count as number | null,
          snapshotDate: s.snapshot_date as string,
        });
      }
    }
  }

  const now = Date.now();
  return rows.map((row) => {
    const last = (row.last_refreshed_at ?? row.added_at) as string;
    const ageDays = Math.floor((now - new Date(last).getTime()) / 86_400_000);
    const isStale = ageDays >= (row.refresh_interval_days as number);
    const id = row.id as string;
    const latest = latestByCreator.get(id);
    return {
      id,
      type: row.type as string,
      subject: row.subject as string,
      addedAt: row.added_at as string,
      lastRefreshedAt: row.last_refreshed_at as string | undefined,
      refreshIntervalDays: row.refresh_interval_days as number,
      ageDays,
      isStale,
      botScore: latest?.botScore ?? null,
      followerCount: latest?.followerCount ?? null,
      lastSnapshotDate: latest?.snapshotDate ?? null,
      snapshotCount: snapshotCountByCreator.get(id) ?? 0,
      trajectoryScore: row.trajectory_score as number | null,
      trajectoryLabel: row.trajectory_label as string | null,
    };
  });
}

export async function addToWatchlistForUser(
  subject: string,
  type: string,
  refreshIntervalDays = 3
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Check if already exists
  const { data: existing } = await supabase
    .from("watchlist")
    .select("id")
    .eq("user_id", user.id)
    .ilike("subject", subject)
    .eq("type", type)
    .single();

  if (existing) return existing;

  const id = `watch-${Date.now()}`;
  const { error } = await supabase.from("watchlist").insert({
    id,
    user_id: user.id,
    type,
    subject,
    added_at: new Date().toISOString(),
    refresh_interval_days: refreshIntervalDays,
  });
  if (error) throw error;
  return { id };
}

export async function removeFromWatchlistForUser(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("watchlist").delete().eq("id", id);
  if (error) throw error;
}

export async function updateWatchlistRefreshForUser(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("watchlist")
    .update({ last_refreshed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// --- Deep dives ---

export async function saveDeepDiveForUser(bundle: {
  id: string;
  company: string;
  generatedAt: string;
  durationMs: number;
  sections: unknown[];
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Replace existing
  await supabase
    .from("deep_dives")
    .delete()
    .eq("user_id", user.id)
    .ilike("company", bundle.company);

  const { error } = await supabase.from("deep_dives").insert({
    id: bundle.id,
    user_id: user.id,
    company: bundle.company,
    generated_at: bundle.generatedAt,
    duration_ms: bundle.durationMs,
    sections: bundle.sections,
  });
  if (error) throw error;
}

export async function getDeepDiveForUser(company: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("deep_dives")
    .select("*")
    .ilike("company", company)
    .single();
  if (error || !data) return null;
  return {
    id: data.id as string,
    company: data.company as string,
    generatedAt: data.generated_at as string,
    durationMs: data.duration_ms as number,
    sections: data.sections as unknown[],
  };
}
