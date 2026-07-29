import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServerSupabaseClient, createServiceClient } from "../../../lib/supabase/server";

const execFileAsync = promisify(execFile);

/**
 * GET lists the discovery review queue. Originally tried importing
 * listCandidates directly from src/agents/creator-discovery-agent via
 * the @src/* tsconfig alias — `tsc --noEmit` accepted it, but `next
 * build` failed with "Module not found": Next's webpack bundler won't
 * resolve a path escaping web/'s own directory, tsconfig paths there
 * notwithstanding. Querying directly here instead (same shape as
 * listCandidates, just inlined) for the dev-fallback branch only —
 * production always goes through agent-server.ts, a plain Node process
 * with no such bundler restriction, which does import the agent module
 * directly.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status") ?? undefined;
  const agentUrl = process.env.AGENT_SERVER_URL;

  if (agentUrl) {
    const url = new URL(`${agentUrl}/creator-discovery/candidates`);
    url.searchParams.set("userId", user.id);
    if (statusParam) url.searchParams.set("status", statusParam);
    const res = await fetch(url.toString(), {
      headers: { "x-agent-secret": process.env.AGENT_SECRET ?? "" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const validStatus = statusParam === "pending" || statusParam === "promoted" || statusParam === "rejected" ? statusParam : undefined;
  const supabaseAdmin = createServiceClient();
  let query = supabaseAdmin
    .from("creator_discovery_candidates")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (validStatus) query = query.eq("status", validStatus);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const res = await fetch(`${agentUrl}/creator-discovery/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": process.env.AGENT_SECRET ?? "" },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const PROJECT_ROOT = join(process.cwd(), "..");
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsx", "run-creator-discovery.mjs"],
      { cwd: PROJECT_ROOT, timeout: 120_000, env: { ...process.env } }
    );
    return NextResponse.json({ ok: true, output: stdout + stderr });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    return NextResponse.json(
      { error: error.message, stderr: error.stderr, stdout: error.stdout },
      { status: 500 }
    );
  }
}
