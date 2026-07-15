import { NextResponse } from "next/server";
import { requireInternalTier } from "../../../../lib/require-internal-tier";
import { createServiceClient } from "../../../../lib/supabase/server";

const SENTRY_ORG = "zuse-holdings-llc";
const SENTRY_PROJECT = "javascript-nextjs";
const GITHUB_OWNER = "Zuse-Holding";
const GITHUB_REPO = "Charon";

export async function GET() {
  const gate = await requireInternalTier();
  if (!gate.ok) {
    return NextResponse.json({ error: "Not found" }, { status: gate.status === 401 ? 401 : 404 });
  }

  const [agentRuns, sentryIssues, prStatus, supabaseCounts] = await Promise.all([
    fetchAgentRuns(),
    fetchSentryIssues(),
    fetchPrStatus(),
    fetchSupabaseCounts(),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    agentRuns,
    sentryIssues,
    prStatus,
    supabaseCounts,
  });
}

async function fetchAgentRuns() {
  try {
    const supabase = createServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: last24h } = await supabase
      .from("agent_runs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    const { data: last10 } = await supabase
      .from("agent_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    return { last24h: last24h ?? [], last10: last10 ?? [], error: null };
  } catch (err) {
    return { last24h: [], last10: [], error: String(err) };
  }
}

async function fetchSentryIssues() {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) return { issues: [], bugWatcherOpenCount: 0, error: "SENTRY_AUTH_TOKEN not configured" };

  try {
    const [allRes, intelFeedRes] = await Promise.all([
      fetch(
        `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&statsPeriod=24h`,
        { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 60 } }
      ),
      // Scoped count for the Bug Watcher node/sidebar specifically.
      fetch(
        `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved%20route:intel-feed&statsPeriod=24h`,
        { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 60 } }
      ),
    ]);

    if (!allRes.ok) return { issues: [], bugWatcherOpenCount: 0, error: `Sentry API ${allRes.status}` };

    const data: any[] = await allRes.json();
    const issues = data.map(i => ({
      id: i.id,
      shortId: i.shortId,
      title: i.title,
      culprit: i.culprit,
      count: i.count,
      firstSeen: i.firstSeen,
      lastSeen: i.lastSeen,
      permalink: i.permalink,
    }));

    const bugWatcherOpenCount = intelFeedRes.ok ? (await intelFeedRes.json()).length : 0;

    return { issues, bugWatcherOpenCount, error: null };
  } catch (err) {
    return { issues: [], bugWatcherOpenCount: 0, error: String(err) };
  }
}

async function fetchPrStatus() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { prs: [], error: "GITHUB_TOKEN not configured" };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?state=all&per_page=30&sort=created&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return { prs: [], error: `GitHub API ${res.status}` };

    const data: any[] = await res.json();
    const prs = data
      .filter(pr => pr.head?.ref?.startsWith("fix/"))
      .map(pr => ({
        number: pr.number,
        title: pr.title,
        branch: pr.head.ref,
        state: pr.merged_at ? "merged" : pr.state,
        draft: pr.draft,
        url: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      }));
    return { prs, error: null };
  } catch (err) {
    return { prs: [], error: String(err) };
  }
}

async function fetchSupabaseCounts() {
  try {
    const supabase = createServiceClient();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const { count: signupsToday } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfToday.toISOString());

    const { count: activeTrials } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("tier", "trial")
      .gt("trial_expires_at", new Date().toISOString());

    const { data: tierRows } = await supabase
      .from("profiles")
      .select("tier");

    const tierDistribution: Record<string, number> = {};
    for (const row of tierRows ?? []) {
      tierDistribution[row.tier] = (tierDistribution[row.tier] ?? 0) + 1;
    }

    return {
      signupsToday: signupsToday ?? 0,
      activeTrials: activeTrials ?? 0,
      tierDistribution,
      // No historical tier-change tracking exists yet — this is a
      // point-in-time snapshot, not a delta.
      note: "tierDistribution is a current snapshot; no history table exists yet to detect tier changes over time.",
      error: null,
    };
  } catch (err) {
    return { signupsToday: 0, activeTrials: 0, tierDistribution: {}, error: String(err) };
  }
}
