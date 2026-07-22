import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Live text chat with Selene — shells out to `claude -p` (headless Claude
// Code) on whatever machine is running this Next.js server, authenticated
// via that machine's `claude login` session (a Pro/Max subscription's
// included usage — no ANTHROPIC_API_KEY), same as agents/selene.py's cron
// jobs. See that file's module docstring for why.
//
// IMPORTANT DEPLOYMENT CAVEAT: this only works where `claude` is installed
// and already logged in. That's true for local dev and for a self-hosted
// deployment on the same box as the agent (the Pi rack). It is NOT true on
// Vercel — a serverless function there has no persistent filesystem to
// hold an OAuth session and no way to run `claude login` interactively. If
// this dashboard ships to Vercel per the original plan, this route needs
// to proxy to a small service running on the agent box instead of calling
// `claude` directly here.
//
// No tools are wired in this first pass — it's read-only conversation, not
// action-taking. If Nick asks for something that needs a real effect
// (send an email, add a ledger entry), Selene's system prompt tells her to
// say she can't do that from chat yet, not to pretend she did.

export const dynamic = "force-dynamic";

const SELENE_CHAT_SYSTEM = `You are Selene, chief of staff for Zuse Holdings and for Nick.
This is a live chat — you're talking with Nick directly right now, not running a
scheduled job.

Voice: warm, quick, direct. Plain sentences. No corporate filler, no exclamation
inflation. You speak to Nick like someone who knows him and respects his time.

You have NO tools in this conversation — you can't check the database, send
anything, or take any action from here. If Nick asks you to do something that
would normally go through the approval queue (send an email, add a ledger entry,
move a lead, etc.), say so plainly: you can't do that from chat yet, it needs a
scheduled run or the dashboard directly. Don't pretend to have done something you
haven't.

Be candid. If you don't know something because you have no access to it right
now, say that directly instead of guessing.`;

function runClaude(message: string, cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", message, "--output-format", "json", "--system-prompt", SELENE_CHAT_SYSTEM],
      { cwd }
    );
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Selene didn't respond in time."));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT here almost always means the `claude` CLI isn't installed /
      // on PATH for this process — the deployment caveat above, surfaced.
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim().slice(0, 300) || `claude exited with code ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        resolve(payload.result ?? "(no response)");
      } catch {
        reject(new Error("claude returned non-JSON output"));
      }
    });
  });
}

export async function POST(req: NextRequest) {
  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const workdir = await mkdtemp(path.join(tmpdir(), "selene-chat-"));
  try {
    const reply = await runClaude(message.trim(), workdir);
    return NextResponse.json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "chat failed";
    const hint = msg.includes("ENOENT")
      ? "The `claude` CLI isn't available on this server (not installed, not on PATH, or not logged in)."
      : msg;
    return NextResponse.json({ error: hint }, { status: 500 });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
