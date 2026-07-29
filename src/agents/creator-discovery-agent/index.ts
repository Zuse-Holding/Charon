/**
 * Creator Discovery Agent
 *
 * Serper-based trend scraping — surfaces creators not yet on anyone's
 * watchlist by searching a fixed set of "who's rising" queries per niche,
 * extracting name/handle candidates from the results, and queuing them
 * for review. Feeds the same watchlist + creator-snapshot-agent pipeline
 * that a manually-searched-and-Watched creator already goes through —
 * this agent's only job is finding candidates, not scoring them.
 *
 * Flow:
 * 1. Run 3 fixed Serper queries per configured niche
 * 2. Extract @handle / name candidates from titles+snippets
 *    (src/lib/candidate-extraction.ts — regex/heuristic, not NER)
 * 3. Upsert into creator_discovery_candidates as status='pending'
 *    (re-discovering an already-reviewed candidate just bumps
 *    last_seen_at — never resets a decided status back to pending)
 * 4. A human reviews the pending queue (Watchlist page's Discovery
 *    section) and promotes or rejects each one — see promoteCandidate/
 *    rejectCandidate below. Nothing here auto-promotes: passing the
 *    extraction/shape filter means "plausibly a name," not "confirmed
 *    rising creator." Discovery is noisy by design; that's the point of
 *    the manual queue, not a bug to engineer away in v1.
 *
 * Usage:
 *   tsx src/agents/creator-discovery-agent/index.ts
 *   or call runCreatorDiscoveryAgent() from a scheduled job
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SerperSearchProvider } from "../../lib/providers.js";
import { extractCandidates } from "../../lib/candidate-extraction.js";

const PLATFORM = "tiktok";
const DELAY_BETWEEN_QUERIES_MS = 600;
const RESULTS_PER_QUERY = 10;

// Start with these three; add niches here as the discovery net widens.
const NICHES = ["business", "finance", "tech"];

function buildQueries(niche: string): string[] {
  return [
    `rising ${niche} creators 2026`,
    `creators to watch ${niche}`,
    `trending hashtag ${niche} TikTok`,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supabaseClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface DiscoveryOutcome {
  niche: string;
  query: string;
  candidatesFound: number;
  newCandidates: number;
}

export async function runCreatorDiscoveryAgent(): Promise<DiscoveryOutcome[]> {
  const supabase = supabaseClient();
  const searcher = new SerperSearchProvider();
  const outcomes: DiscoveryOutcome[] = [];

  for (const niche of NICHES) {
    for (const query of buildQueries(niche)) {
      try {
        const results = await searcher.search(query, RESULTS_PER_QUERY);
        const candidates = extractCandidates(results);

        let newCount = 0;
        for (const candidate of candidates) {
          const inserted = await upsertCandidate(supabase, candidate, niche, query);
          if (inserted) newCount++;
        }

        console.log(`[creator-discovery-agent] "${query}" — ${results.length} result(s), ${candidates.length} candidate(s), ${newCount} new`);
        outcomes.push({ niche, query, candidatesFound: candidates.length, newCandidates: newCount });
      } catch (err) {
        console.error(`[creator-discovery-agent] Query failed: "${query}"`, err instanceof Error ? err.message : err);
        outcomes.push({ niche, query, candidatesFound: 0, newCandidates: 0 });
      }

      await sleep(DELAY_BETWEEN_QUERIES_MS);
    }
  }

  const totalNew = outcomes.reduce((s, o) => s + o.newCandidates, 0);
  console.log(`[creator-discovery-agent] Done — ${totalNew} new candidate(s) across ${outcomes.length} quer(ies).`);
  return outcomes;
}

// Returns true if this was a genuinely new row (for the "N new" count in
// outcomes above) — a re-discovery of an existing candidate just bumps
// last_seen_at and returns false, regardless of its current status.
async function upsertCandidate(
  supabase: SupabaseClient,
  candidate: { raw: string; sourceUrl: string; sourceSnippet: string },
  niche: string,
  query: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("creator_discovery_candidates")
    .select("id")
    .eq("raw_candidate", candidate.raw)
    .eq("platform", PLATFORM)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("creator_discovery_candidates")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("creator_discovery_candidates").insert({
    raw_candidate: candidate.raw,
    platform: PLATFORM,
    niche,
    source_query: query,
    source_url: candidate.sourceUrl,
    source_snippet: candidate.sourceSnippet,
    status: "pending",
  });

  if (error) {
    console.error(`[creator-discovery-agent] Insert failed for "${candidate.raw}":`, error.message);
    return false;
  }
  return true;
}

export interface DiscoveryCandidate {
  id: string;
  raw_candidate: string;
  platform: string;
  niche: string;
  source_query: string;
  source_url: string | null;
  source_snippet: string | null;
  status: "pending" | "promoted" | "rejected";
  notes: string | null;
  watchlist_id: string | null;
  discovered_at: string;
  last_seen_at: string;
  reviewed_at: string | null;
}

export async function listCandidates(status?: "pending" | "promoted" | "rejected"): Promise<DiscoveryCandidate[]> {
  const supabase = supabaseClient();
  let query = supabase.from("creator_discovery_candidates").select("*").order("last_seen_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query.returns<DiscoveryCandidate[]>();
  if (error) throw new Error(`[creator-discovery-agent] listCandidates failed: ${error.message}`);
  return data ?? [];
}

// Promotion creates the actual watchlist row this candidate needs to
// enter the normal creator-snapshot pipeline — same table/shape a
// manually-searched-and-Watched creator lands in, so creator-snapshot-
// agent picks it up on its next run with no special-casing.
export async function promoteCandidate(candidateId: string, userId: string): Promise<{ watchlistId: string }> {
  const supabase = supabaseClient();
  const { data: candidate, error: fetchError } = await supabase
    .from("creator_discovery_candidates")
    .select("*")
    .eq("id", candidateId)
    .single<DiscoveryCandidate>();

  if (fetchError || !candidate) throw new Error(`Candidate ${candidateId} not found`);
  if (candidate.status === "promoted" && candidate.watchlist_id) {
    return { watchlistId: candidate.watchlist_id };
  }

  const watchlistId = `watch-${Date.now()}`;
  const { error: insertError } = await supabase.from("watchlist").insert({
    id: watchlistId,
    user_id: userId,
    type: "creator",
    subject: candidate.raw_candidate,
    added_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(`Failed to create watchlist row: ${insertError.message}`);

  const { error: updateError } = await supabase
    .from("creator_discovery_candidates")
    .update({ status: "promoted", watchlist_id: watchlistId, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (updateError) throw new Error(`Failed to mark candidate promoted: ${updateError.message}`);

  return { watchlistId };
}

// Rejection always records a reason — "don't silently drop" per this
// agent's own spec, so the review queue stays auditable rather than
// candidates just disappearing with no trace of why.
export async function rejectCandidate(candidateId: string, reason: string): Promise<void> {
  const supabase = supabaseClient();
  const { error } = await supabase
    .from("creator_discovery_candidates")
    .update({ status: "rejected", notes: reason, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw new Error(`Failed to reject candidate ${candidateId}: ${error.message}`);
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runCreatorDiscoveryAgent()
    .then((outcomes) => {
      console.log(`\n[creator-discovery-agent] Finished. ${outcomes.length} quer(ies) run.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[creator-discovery-agent] Fatal error:", err);
      process.exit(1);
    });
}
