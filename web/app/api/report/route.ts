import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

// Local dev only: reports the agent server wrote to ./reports. Never in
// production, and never outside that folder, whatever path is passed.
const REPORTS_DIR = resolve(process.cwd(), "..", "reports");
function localReport(path: string | null): string | null {
  if (process.env.NODE_ENV === "production" || !path) return null;
  const full = resolve(path);
  if (!full.startsWith(REPORTS_DIR + sep) || !full.endsWith(".md") || !existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const subject = req.nextUrl.searchParams.get("subject");
  // The run itself, when known: by subject, a newer or older run of the
  // same search could answer instead (Oct 29).
  const id = req.nextUrl.searchParams.get("id");

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });

  const local = localReport(path);
  if (local !== null) {
    return new NextResponse(local, { headers: { "Content-Type": "text/plain" } });
  }

  // The saved bundle. RLS on research_runs limits this to the user's own runs.
  try {
    
    // Try to find by subject or by report_path
    const query = supabase
      .from("research_runs")
      .select("bundle, subject")
      .order("generated_at", { ascending: false })
      .limit(1);

    if (id) {
      query.eq("id", id);
    } else if (subject) {
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
