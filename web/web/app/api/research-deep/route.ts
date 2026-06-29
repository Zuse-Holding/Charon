import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// process.cwd() in Next.js dev server is the web/ folder.
// The project root (containing src/) is one level up.
const PROJECT_ROOT = join(process.cwd(), "..");

export async function POST(req: NextRequest) {
  const { subject } = await req.json();
  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }

  const safeSubject = subject.replace(/"/g, '\\"');
  const cmd = `npx tsx src/cli.ts research-deep "${safeSubject}"`;

  console.log(`[research-deep] cwd: ${PROJECT_ROOT}`);
  console.log(`[research-deep] cmd: ${cmd}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      // Deep dive takes longer — 5 min timeout
      timeout: 300_000,
      env: { ...process.env },
    });
    console.log("[research-deep] stdout:", stdout);
    if (stderr) console.log("[research-deep] stderr:", stderr);
    return NextResponse.json({ ok: true, output: stdout + stderr });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    console.error("[research-deep] failed:", error.message);
    return NextResponse.json(
      { error: error.message, stderr: error.stderr, stdout: error.stdout },
      { status: 500 }
    );
  }
}
