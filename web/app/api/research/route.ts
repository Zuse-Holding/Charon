import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

const CLI_COMMANDS: Record<string, string> = {
  company: "research",
  person:  "research-person",
  product: "research-product",
};

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getReportPath(subject: string, type: string): string {
  const root = join(process.cwd(), "..");
  if (type === "person") return join(root, "reports", "people", `${slugify(subject)}.md`);
  if (type === "product") return join(root, "reports", "products", `${slugify(subject)}.md`);
  return join(root, "reports", `${slugify(subject)}.md`);
}

export async function POST(req: NextRequest) {
  const { subject, type } = await req.json();
  if (!subject || !type || !CLI_COMMANDS[type]) {
    return NextResponse.json({ error: "subject and valid type required" }, { status: 400 });
  }

  // Production: proxy to VPS
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const res = await fetch(`${agentUrl}/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET ?? "",
      },
      body: JSON.stringify({ subject, type, userId: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  // Development: spawn CLI, then save to Supabase
  const PROJECT_ROOT = join(process.cwd(), "..");
  const safeSubject = subject.replace(/"/g, '\\"');
  const cmd = `npx tsx src/cli.ts ${CLI_COMMANDS[type]} "${safeSubject}"`;

  console.log(`[research] cwd: ${PROJECT_ROOT}`);
  console.log(`[research] cmd: ${cmd}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      env: { ...process.env },
    });
    console.log("[research] stdout:", stdout);
    if (stderr) console.log("[research] stderr:", stderr);

    // Save to Supabase so the dashboard can see it
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const reportPath = getReportPath(subject, type);
        await supabase.from("research_runs").insert({
          id: randomUUID(),
          user_id: user.id,
          type,
          subject,
          generated_at: new Date().toISOString(),
          report_path: reportPath,
          bundle: {},
        });
      }
    } catch (dbErr) {
      console.error("[research] Supabase write failed:", dbErr);
      // Don't fail the request — report was written to disk successfully
    }

    return NextResponse.json({ ok: true, output: stdout + stderr });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    console.error("[research] failed:", error.message);
    return NextResponse.json(
      { error: error.message, stderr: error.stderr, stdout: error.stdout },
      { status: 500 }
    );
  }
}
