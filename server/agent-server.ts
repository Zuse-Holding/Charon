/**
 * VPS Agent Server
 * Runs on a DigitalOcean Droplet (or any Node.js server).
 * Accepts research requests from the Next.js frontend and
 * streams results back via SSE — no 30-second timeout like Vercel.
 * Writes results directly to Supabase using the service role key.
 *
 * Setup on VPS:
 *   npm install
 *   cp .env.example .env  # add all keys
 *   node server/agent-server.js
 *   # or with PM2: pm2 start server/agent-server.js --name seline-agents
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResearchOrchestrator } from "../src/agents/orchestrator/index.js";
import { DeepDiveAgent } from "../src/agents/deep-dive/index.js";
import { DirectFetchProvider, SerperSearchProvider } from "../src/lib/providers.js";
import { createClient } from "@supabase/supabase-js";

const app  = express();
const PORT = process.env.PORT ?? process.env.AGENT_PORT ?? 4000;

// Allow requests from your Vercel frontend domain
const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());

// Shared secret — Next.js sends this header, server validates it
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

function authCheck(req: express.Request, res: express.Response): boolean {
  const secret = req.headers["x-agent-secret"];
  if (secret !== AGENT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// Supabase service role client — bypasses RLS for writing results
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const REPORTS_DIR = join(process.cwd(), "reports");
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(join(REPORTS_DIR, "people"), { recursive: true });
mkdirSync(join(REPORTS_DIR, "products"), { recursive: true });

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// --- Quick research (Tier 1) ---
app.post("/research", async (req, res) => {
  if (!authCheck(req, res)) return;
  const { subject, type, userId } = req.body;
  if (!subject || !type || !userId) {
    res.status(400).json({ error: "subject, type, and userId required" });
    return;
  }

  try {
    const orchestrator = new ResearchOrchestrator();
    let bundle: unknown;
    let report: string;
    let outPath: string;

    if (type === "company") {
      const result = await orchestrator.researchCompany(subject);
      bundle = result.bundle; report = result.report;
      outPath = join(REPORTS_DIR, `${slugify(subject)}.md`);
    } else if (type === "person") {
      const result = await orchestrator.researchPerson(subject);
      bundle = result.bundle; report = result.report;
      outPath = join(REPORTS_DIR, "people", `${slugify(subject)}.md`);
    } else {
      const result = await orchestrator.researchProduct(subject);
      bundle = result.bundle; report = result.report;
      outPath = join(REPORTS_DIR, "products", `${slugify(subject)}.md`);
    }

    writeFileSync(outPath, report, "utf-8");

    // Write to Supabase
 const { error } = await supabase.from("research_runs").insert({
  id: randomUUID(),
  user_id: userId,
  type,
  subject,
  generated_at: new Date().toISOString(),
  report_path: outPath,
  bundle: { ...(bundle as object), reportMarkdown: report },
});

    if (error) throw error;
    res.json({ ok: true, reportPath: outPath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Deep dive (Tier 2) — SSE streaming ---
app.post("/deep-dive", async (req, res) => {
  if (!authCheck(req, res)) return;
  const { company, userId } = req.body;
  if (!company || !userId) {
    res.status(400).json({ error: "company and userId required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const fetcher = new DirectFetchProvider();
    const searcher = new SerperSearchProvider();
    const agent = new DeepDiveAgent(fetcher, searcher);

    const bundle = await agent.run(company, send);

    // Write to Supabase
    await supabase.from("deep_dives").upsert({
      id: bundle.id,
      user_id: userId,
      company: bundle.company,
      generated_at: bundle.generatedAt,
      duration_ms: bundle.durationMs,
      sections: bundle.sections,
    });

    res.end();
  } catch (err) {
    send({ type: "error", error: String(err), totalSections: 10 });
    res.end();
  }
});

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SELINE Agent Server running on port ${PORT}`);
});
