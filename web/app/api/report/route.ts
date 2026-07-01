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

  // Fall back to Supabase bundle (works in production on Vercel)
  try {
    const supabase = await createServerSupabaseClient();
    
    // Try to find by subject or by report_path
    const query = supabase
      .from("research_runs")
      .select("bundle, subject")
      .order("generated_at", { ascending: false })
      .limit(1);

    if (subject) {
      query.ilike("subject", subject);
    } else if (path) {
      // Extract subject from path slug
      query.eq("report_path", path);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return new NextResponse("Report not found", { status: 404 });
    }

    const bundle = data.bundle as Record<string, unknown>;
    const markdown = bundle?.reportMarkdown as string;

    if (!markdown) {
      return new NextResponse("Report content not available", { status: 404 });
    }

    return new NextResponse(markdown, { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return new NextResponse("Error fetching report", { status: 500 });
  }
}
