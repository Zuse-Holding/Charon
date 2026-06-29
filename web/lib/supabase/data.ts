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
  const { data, error } = await supabase
    .from("research_runs")
    .select("*")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeRun);
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

  const now = Date.now();
  return (data ?? []).map((row) => {
    const last = (row.last_refreshed_at ?? row.added_at) as string;
    const ageDays = Math.floor((now - new Date(last).getTime()) / 86_400_000);
    const isStale = ageDays >= (row.refresh_interval_days as number);
    return {
      id: row.id as string,
      type: row.type as string,
      subject: row.subject as string,
      addedAt: row.added_at as string,
      lastRefreshedAt: row.last_refreshed_at as string | undefined,
      refreshIntervalDays: row.refresh_interval_days as number,
      ageDays,
      isStale,
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
