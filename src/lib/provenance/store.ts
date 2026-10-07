import type { SupabaseClient } from "@supabase/supabase-js";
import { FindingSchema, type Finding } from "./findings.js";
import type { Snapshot } from "./snapshots.js";

/**
 * Saves a run's provenance: each raw source response to the private
 * "snapshots" storage bucket (path {user}/{run}/{sha256}), plus one
 * source_snapshots row and one findings row each. The database enforces
 * the same required fields as FindingSchema (supabase/schema.sql), so a
 * finding missing its source URL or retrieval time can't be stored by
 * any path.
 *
 * Called after the report is saved. Failures are reported to the caller
 * to log; they never undo the report.
 */
export const SNAPSHOT_BUCKET = "snapshots";
const UPLOAD_CONCURRENCY = 6;

export function snapshotPath(userId: string, runId: string, sha: string): string {
  return `${userId}/${runId}/${sha}`;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function persistProvenance(
  supabase: SupabaseClient,
  args: { userId: string; runId: string; snapshots: Snapshot[]; findings: Finding[] },
): Promise<{ snapshots: number; findings: number }> {
  const { userId, runId } = args;
  const unique = [...new Map(args.snapshots.map((s) => [s.sha256, s])).values()];

  const failedUploads: string[] = [];
  await inBatches(unique, UPLOAD_CONCURRENCY, async (s) => {
    const { error } = await supabase.storage.from(SNAPSHOT_BUCKET)
      .upload(snapshotPath(userId, runId, s.sha256), s.body, { contentType: "text/plain; charset=utf-8", upsert: true });
    if (error) failedUploads.push(s.sha256);
  });
  if (failedUploads.length > 0) {
    throw new Error(`${failedUploads.length} of ${unique.length} snapshot uploads failed`);
  }

  const { error: snapError } = await supabase.from("source_snapshots").upsert(unique.map((s) => ({
    run_id: runId,
    sha256: s.sha256,
    user_id: userId,
    url: s.url,
    host: s.host,
    retrieved_at: s.retrievedAt,
    status: s.status,
    content_type: s.contentType,
    bytes: Buffer.byteLength(s.body, "utf8"),
    generated: Boolean(s.generated),
    storage_path: snapshotPath(userId, runId, s.sha256),
  })), { onConflict: "run_id,sha256" });
  if (snapError) throw new Error(`source_snapshots: ${snapError.message}`);

  // Validated again at the boundary: nothing reaches the table unchecked.
  const rows = args.findings.map((f) => ({ run_id: runId, user_id: userId, ...FindingSchema.parse(f) }));
  if (rows.length > 0) {
    const { error } = await supabase.from("findings").insert(rows);
    if (error) throw new Error(`findings: ${error.message}`);
  }
  return { snapshots: unique.length, findings: rows.length };
}
