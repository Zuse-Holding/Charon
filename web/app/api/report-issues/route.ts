import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

/**
 * Task 3.4 — "Something wrong in this report?" Stores the submission in
 * report_issues (real, reliable) and hands back a mailto: URL for the
 * client to open (see web/components/ReportIssueForm.tsx) rather than
 * actually sending an email server-side — there's no transactional email
 * provider wired up anywhere in this codebase (same open decision
 * AUDIT.md flagged for Phase 4.2's welcome/day-7/cap-reached emails), so
 * "sends an email automatically" isn't honestly achievable yet. A mailto:
 * link is the closest real approximation available today: it still gets
 * a human-readable report to support@ without requiring a backend
 * provider, it just needs the user to hit send in their own mail client
 * rather than happening silently server-side.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { runId, reportKind, entityName, section, message, correctValue } = await req.json().catch(() => ({}));

    if (!runId || !reportKind || !entityName || !message?.trim()) {
      return NextResponse.json({ error: "runId, reportKind, entityName, and message are required." }, { status: 400 });
    }
    if (reportKind !== "quick" && reportKind !== "deep-dive") {
      return NextResponse.json({ error: "reportKind must be 'quick' or 'deep-dive'." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("report_issues")
      .insert({
        user_id: user.id,
        run_id: String(runId),
        report_kind: reportKind,
        entity_name: entityName,
        section: section || null,
        message: message.trim(),
        correct_value: correctValue?.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[report-issues] insert failed:", error);
      return NextResponse.json({ error: "Could not save your report — please try again." }, { status: 500 });
    }

    const subject = `Metis report issue — ${entityName}`;
    const bodyLines = [
      `Report ID: ${runId} (${reportKind})`,
      `Entity: ${entityName}`,
      `Section: ${section || "(not specified)"}`,
      `User: ${user.email}`,
      ``,
      `What's wrong:`,
      message.trim(),
      ...(correctValue?.trim() ? [``, `Suggested correct value:`, correctValue.trim()] : []),
    ];
    const mailtoUrl = `mailto:support@metisanalytic.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

    return NextResponse.json({ ok: true, issueId: data.id, mailtoUrl });
  } catch (err) {
    console.error("[report-issues] failed:", err);
    return NextResponse.json({ error: "Could not save your report — please try again." }, { status: 500 });
  }
}
