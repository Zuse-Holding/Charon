import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
  if (!existsSync(path)) return new NextResponse("Report not found", { status: 404 });
  const content = readFileSync(path, "utf-8");
  return new NextResponse(content, { headers: { "Content-Type": "text/plain" } });
}
