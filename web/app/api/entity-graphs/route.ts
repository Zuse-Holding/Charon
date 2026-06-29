import { NextResponse } from "next/server";
import { getAllEntityGraphs, deleteEntityGraph } from "../../../../src/database/entity-store";
import { NextRequest } from "next/server";

export async function GET() {
  try {
    const graphs = getAllEntityGraphs();
    return NextResponse.json(graphs);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    deleteEntityGraph(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
