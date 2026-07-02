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

// In-memory rate limiter — per user, resets hourly
// Simple enough for current scale; swap for Redis when needed
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX     = 20;  // max runs per window
const RATE_LIMIT_WINDOW  = 60 * 60 * 1000; // 1 hour in ms

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now    = Date.now();
  const record = rateLimitMap.get(userId);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetIn: RATE_LIMIT_WINDOW };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetIn: record.resetAt - now };
  }

  record.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count, resetIn: record.resetAt - now };
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

  // Production: proxy to Railway agent server
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Rate limit check
    const limit = checkRateLimit(user.id);
    if (!limit.allowed) {
      const resetMinutes = Math.ceil(limit.resetIn / 60000);
      return NextResponse.json(
        { error: `Rate limit reached. You can run more research in ${resetMinutes} minutes.` },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit":     String(RATE_LIMIT_MAX),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset":     String(Math.ceil((Date.now() + limit.resetIn) / 1000)),
          },
        }
      );
    }

    const res = await fetch(`${agentUrl}/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET ?? "",
      },
      body: JSON.stringify({ subject: sanitizedSubject, type, userId: user.id }),
    });
    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: {
        "X-RateLimit-Limit":     String(RATE_LIMIT_MAX),
        "X-RateLimit-Remaining": String(limit.remaining),
      },
    });
  }

  // Development: spawn CLI
  const PROJECT_ROOT = join(process.cwd(), "..");
  const safeSubject  = sanitizedSubject.replace(/"/g, '\\"');
  const cmd = `npx tsx src/cli.ts ${CLI_COMMANDS[type]} "${safeSubject}"`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      env: { ...process.env },
    });

    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const reportPath = getReportPath(sanitizedSubject, type);
        await supabase.from("research_runs").insert({
          id: randomUUID(),
          user_id: user.id,
          type,
          subject: sanitizedSubject,
          generated_at: new Date().toISOString(),
          report_path: reportPath,
          bundle: {},
        });
      }
    } catch (dbErr) {
      console.error("[research] Supabase write failed:", dbErr);
    }

    return NextResponse.json({ ok: true, output: stdout + stderr });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    return NextResponse.json(
      { error: error.message, stderr: error.stderr, stdout: error.stdout },
      { status: 500 }
    );
  }
}
