import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const execAsync = promisify(exec);

/**
 * Deep dive route — two modes:
 * Production: proxies SSE stream from VPS agent server
 * Development: spawns CLI child process, streams SSE back to browser
 */
export async function POST(req: NextRequest) {
  const { company } = await req.json();
  if (!company) {
    return NextResponse.json({ error: "company required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Production: proxy to VPS SSE stream
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const upstream = await fetch(`${agentUrl}/deep-dive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET ?? "",
      },
      body: JSON.stringify({ company, userId: user.id }),
    });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Development: spawn CLI deep-dive command and stream progress
  const PROJECT_ROOT = join(process.cwd(), "..");
  const safeCompany = company.replace(/"/g, '\\"');
  const cmd = `npx tsx src/cli.ts deep-dive "${safeCompany}"`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        // Run deep dive CLI command
        const { stdout } = await execAsync(cmd, {
          cwd: PROJECT_ROOT,
          timeout: 300_000, // 5 minutes for deep dive
          env: { ...process.env },
        });

        // Parse sections from output (CLI writes JSON to stdout)
        try {
          const bundle = JSON.parse(stdout);

          // Save to Supabase
          await supabase.from("deep_dives").upsert({
            id: bundle.id,
            user_id: user.id,
            company: bundle.company,
            generated_at: bundle.generatedAt,
            duration_ms: bundle.durationMs,
            sections: bundle.sections,
          });

          send({ type: "complete", totalSections: 10, bundle });
        } catch {
          send({ type: "error", totalSections: 10, error: "Failed to parse deep dive output" });
        }
      } catch (err) {
        send({ type: "error", totalSections: 10, error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company");
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("deep_dives")
    .select("*")
    .ilike("company", company)
    .single();

  if (error || !data) return new Response(null, { status: 404 });

  return NextResponse.json({
    id: data.id,
    company: data.company,
    generatedAt: data.generated_at,
    durationMs: data.duration_ms,
    sections: data.sections,
  });
}
