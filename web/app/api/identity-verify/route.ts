import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

// Vercel's Node.js serverless functions cap incoming request bodies at
// 4.5MB — base64-encoding two photos inflates their raw size by ~4/3, so
// this has to be checked here (not just agent-server's own 5MB-per-image
// Rekognition limit) or a normal-sized pair of photos would 413 before
// ever reaching the agent server. ~1.5MB raw per photo keeps the combined
// base64 payload safely under that ceiling.
const MAX_IMAGE_LENGTH = 2_000_000; // base64 string length, ~1.5MB raw

export async function POST(req: NextRequest) {
  const { subjectName, imageA, imageB } = await req.json();

  if (typeof imageA !== "string" || typeof imageB !== "string" || !imageA || !imageB) {
    return NextResponse.json({ error: "imageA and imageB required" }, { status: 400 });
  }
  if (imageA.length > MAX_IMAGE_LENGTH || imageB.length > MAX_IMAGE_LENGTH) {
    return NextResponse.json({ error: "Each photo must be under ~1.5MB." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const res = await fetch(`${AGENT_URL}/person-research/verify-photo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
      },
      body: JSON.stringify({
        userId: user.id,
        subjectName: typeof subjectName === "string" ? subjectName.trim().slice(0, 200) || undefined : undefined,
        imageA,
        imageB,
      }),
    });

    const data = await res.json();
    if (res.status === 403) {
      return NextResponse.json({ error: "Photo Identity Verification requires Charon tier" }, { status: 403 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Verification failed" }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/identity-verify] failed:", err);
    return NextResponse.json({ error: "Failed to run Identity Verification" }, { status: 500 });
  }
}
