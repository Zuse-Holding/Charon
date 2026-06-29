import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const subject = req.nextUrl.searchParams.get("subject");

  // Try local filesystem first (works in dev)
  if (path && existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    return new NextResponse(content, { headers: { "Content-Type": "text/plain" } });
  }

  // Fall back to Supabase
  try {
    const supabase = await createServerSupabaseClient();

    let data, error;

    if (subject) {
      ({ data, error } = await supabase
        .from("research_runs")
        .select("bundle")
        .ilike("subject", subject)
        .order("generated_at", { ascending: false })
        .limit(1)
        .single());
    } else if (path) {
      ({ data, error } = await supabase
        .from("research_runs")
        .select("bundle")
        .eq("report_path", path)
        .order("generated_at", { ascending: false })
        .limit(1)
        .single());
    } else {
      return new NextResponse("subject or path required", { status: 400 });
    }

    if (error || !data) return new NextResponse("Report not found", { status: 404 });

    const markdown = (data.bundle as Record<string, unknown>)?.reportMarkdown as string;
    if (!markdown) return new NextResponse("Report content not available — re-run to generate", { status: 404 });

    return new NextResponse(markdown, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return new NextResponse("Error fetching report", { status: 500 });
  }
}