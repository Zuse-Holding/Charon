import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const execFileAsync = promisify(execFile);

/**
 * Manual trigger for creator-snapshot-agent, called by the Watchlist
 * page's "Run snapshot now" button. Same production/dev split as
 * /api/research: production proxies to the Railway agent server (which
 * scopes the run to just this user's own tracked creators — see its
 * /creator-snapshot handler), dev falls back to spawning the CLI script
 * directly, unscoped, since there's no per-user concept locally.
 */
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const res = await fetch(`${agentUrl}/creator-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET ?? "",
      },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  // Development: spawn the CLI script locally — same execFile-with-
  // argument-array pattern as /api/research's dev branch (no shell
  // involved, so no metacharacter-injection risk from anything here).
  const PROJECT_ROOT = join(process.cwd(), "..");
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsx", "run-creator-snapshot.mjs"],
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
