import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { getAllRuns } from "../../../../src/database/store";
import { EntityAgent } from "../../../../src/agents/entity-agent/index";
import { saveEntityGraph, getEntityGraphBySubject } from "../../../../src/database/entity-store";
import { ResearchBundle } from "../../../../src/types/research";

// process.cwd() in Next.js = web/. Project root is one level up.
const _PROJECT_ROOT = join(process.cwd(), "..");

export async function POST(req: NextRequest) {
  const { subject, runId } = await req.json() as {
    subject: string;
    runId?: string;
  };

  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }

  try {
    // Find the research run to get the bundle
    const runs = getAllRuns();
    const run = runId
      ? runs.find((r) => r.id === runId)
      : runs.find((r) => r.subject.toLowerCase() === subject.toLowerCase());

    if (!run || !run.bundle) {
      return NextResponse.json(
        { error: `No research data found for "${subject}". Run a quick profile first.` },
        { status: 404 }
      );
    }

    const bundle = run.bundle as ResearchBundle;

    // Run entity extraction
    const agent = new EntityAgent();
    const graphData = await agent.run(bundle);

    // Save to entity store
    const saved = saveEntityGraph({ ...graphData, runId: run.id });

    return NextResponse.json({
      ok: true,
      graph: saved,
      entityCount: saved.entities.length,
      relationshipCount: saved.relationships.length,
    });
  } catch (err) {
    console.error("[extract-entities]", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const subject = req.nextUrl.searchParams.get("subject");
  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  const graph = getEntityGraphBySubject(subject);
  if (!graph) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(graph);
}
