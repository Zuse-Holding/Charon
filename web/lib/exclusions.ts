import { NextResponse } from "next/server";
import { getAgentSecret } from "./agent-secret";
import { createServerSupabaseClient } from "./supabase/server";

/**
 * Self-exclusion (Feature 6): the web app's routes only proxy to the agent
 * server, which holds the hashing key, Twilio and the email sender. The
 * user id always comes from the session here, never from the browser.
 */

export async function sessionUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function callAgent(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<NextResponse> {
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try {
    const res = await fetch(`${agentUrl}${path}`, {
      method: init.method,
      headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 502 });
  }
}
