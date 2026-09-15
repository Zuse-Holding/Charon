import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { getAgentSecret } from "../../../lib/agent-secret";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const CLI_COMMANDS: Record<string, string> = {
  company:   "research",
  person:    "research-person",
  product:   "research-product",
  political: "research-political",
  creator:   "research-creator",
};

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getReportPath(subject: string, type: string): string {
  const root = join(process.cwd(), "..");
  if (type === "person") return join(root, "reports", "people", `${slugify(subject)}.md`);
  if (type === "product") return join(root, "reports", "products", `${slugify(subject)}.md`);
  if (type === "political") return join(root, "reports", "political", `${slugify(subject)}.md`);
  if (type === "creator") return join(root, "reports", "creators", `${slugify(subject)}.md`);
  return join(root, "reports", `${slugify(subject)}.md`);
}

export async function POST(req: NextRequest) {
  // Validate input
  const body = await req.json();
  const { subject, type } = body;
  if (!subject || !type || !CLI_COMMANDS[type]) {
    return NextResponse.json({ error: "subject and valid type required" }, { status: 400 });
  }

  // Sanitize subject — cap length, no control characters
  const sanitizedSubject = String(subject).trim().slice(0, 200).replace(/[\x00-\x1f]/g, "");
  if (!sanitizedSubject) {
    return NextResponse.json({ error: "Invalid subject" }, { status: 400 });
  }

  // Production: proxy to Railway agent server. Rate limiting (task 3.1)
  // happens there now, not here — agent-server.ts is a persistent process
  // that can hold the limiter state reliably and already knows the
  // caller's tier, where this serverless layer would need an extra
  // lookup for the same tier-aware check (see AUDIT.md on why an
  // in-memory limiter in a Vercel serverless function isn't reliable
  // across instances anyway).
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const res = await fetch(`${agentUrl}/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": getAgentSecret(),
      },
      body: JSON.stringify({ subject: sanitizedSubject, type, userId: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  // Development: spawn CLI (only reachable when AGENT_SERVER_URL isn't
  // set — never true in production since this always points at Railway).
  // Requires the same auth check as the production branch above — this
  // used to run the shell command first and only check for a user
  // afterward, purely to label the DB record, meaning an unauthenticated
  // caller could trigger it. Also switched from a string-interpolated
  // shell command (exec) to execFile with an argument array — that
  // passes sanitizedSubject as a single literal argument to the child
  // process with no shell involved, so shell metacharacters in it
  // (`$`, backticks, `;`, `|`, `&&`) can't be interpreted, unlike the
  // previous version which only escaped double quotes.
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const PROJECT_ROOT = join(process.cwd(), "..");

  // Background-persistent search — same pending/completed/failed pattern
  // as server/agent-server.ts's production path, so a reload during a
  // locally-run research call also has a row to resume from.
  const runId = randomUUID();
  try {
    await supabase.from("research_runs").insert({
      id: runId,
      user_id: user.id,
      type,
      subject: sanitizedSubject,
      generated_at: new Date().toISOString(),
      status: "pending",
    });
  } catch (dbErr) {
    console.error("[research] Supabase pending-row write failed:", dbErr);
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsx", "src/cli.ts", CLI_COMMANDS[type], sanitizedSubject],
      { cwd: PROJECT_ROOT, timeout: 120_000, env: { ...process.env } }
    );

    try {
      const reportPath = getReportPath(sanitizedSubject, type);
      await supabase
        .from("research_runs")
        .update({
          generated_at: new Date().toISOString(),
          report_path: reportPath,
          bundle: {},
          status: "completed",
        })
        .eq("id", runId);
    } catch (dbErr) {
      console.error("[research] Supabase write failed:", dbErr);
    }

    return NextResponse.json({ ok: true, runId, output: stdout + stderr });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    await supabase
      .from("research_runs")
      .update({ status: "failed", error: error.message ?? "Unknown error" })
      .eq("id", runId);
    return NextResponse.json(
      { error: error.message, stderr: error.stderr, stdout: error.stdout },
      { status: 500 }
    );
  }
}
