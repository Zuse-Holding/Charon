import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { AgentJob, AgentRunRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const JOBS: AgentJob[] = ["inbox", "finance", "enrichment", "compliance", "brief"];

export async function GET() {
  const supabase = createServiceClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [last24hRes, last10Res, latestRes, leadsRes, queueRes, deadlinesRes] = await Promise.all([
    supabase.from("agent_runs").select("*").gte("started_at", since24h).order("started_at", { ascending: false }),
    supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(10),
    // Last 50 runs is plenty to find one row per job for "latest by job" without a extra round trip per job.
    supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(50),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("deadlines").select("title, due_date").eq("status", "open").order("due_date", { ascending: true }).limit(1),
  ]);

  const latestByJob: Record<AgentJob, AgentRunRow | null> = Object.fromEntries(
    JOBS.map((job) => [job, null])
  ) as Record<AgentJob, AgentRunRow | null>;
  for (const row of (latestRes.data as AgentRunRow[] | null) ?? []) {
    if (!latestByJob[row.job]) latestByJob[row.job] = row;
  }

  const deadline = deadlinesRes.data?.[0] ?? null;
  const nextDeadline = deadline
    ? {
        title: deadline.title as string,
        dueDate: deadline.due_date as string,
        daysOut: Math.ceil((new Date(deadline.due_date as string).getTime() - Date.now()) / 86_400_000),
      }
    : null;

  return NextResponse.json({
    agentRuns: {
      last24h: last24hRes.data ?? [],
      last10: last10Res.data ?? [],
      latestByJob,
    },
    leadsToday: leadsRes.count ?? 0,
    approvalQueueOpen: queueRes.count ?? 0,
    nextDeadline,
    // Sentry/Vercel aren't wired in this repo (no creds in .env.local.example) —
    // static zero until those integrations actually exist.
    sentryIssues: { bugWatcherOpenCount: 0 },
  });
}
