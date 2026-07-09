/**
 * VPS Agent Server
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResearchOrchestrator } from "../src/agents/orchestrator/index.js";
import { DeepDiveAgent } from "../src/agents/deep-dive/index.js";
import { EntityExtractionAgent } from "../src/agents/entity-extraction/index.js";
import { findEasterEgg } from "../src/easter-eggs/index.js";
import { saveEntityExtraction } from "../src/database/knowledge-graph.js";
import { DirectFetchProvider, SerperSearchProvider } from "../src/lib/providers.js";
import { createClient } from "@supabase/supabase-js";

const app  = express();
const PORT = process.env.PORT ?? process.env.AGENT_PORT ?? 4000;

const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:3000";
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());

const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

function authCheck(req: express.Request, res: express.Response): boolean {
  const secret = req.headers["x-agent-secret"];
  if (secret !== AGENT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Tier = "internal" | "team" | "pro" | "basic" | "free";

interface TierConfig {
  dailyResearchLimit: number;
  dailyDeepDiveLimit: number;
  deepDiveAccess: boolean;
  politicalAccess: boolean;
  watchlistLimit: number;
  knowledgeGraphAccess: boolean;
  exportAccess: boolean;
  jackalProtocol: boolean;
}

const TIER_CONFIG: Record<Tier, TierConfig> = {
  internal: { dailyResearchLimit: -1, dailyDeepDiveLimit: -1, deepDiveAccess: true, politicalAccess: true, watchlistLimit: -1, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: true },
  team:     { dailyResearchLimit: 200, dailyDeepDiveLimit: 20, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 50, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: false },
  pro:      { dailyResearchLimit: 50, dailyDeepDiveLimit: 5, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 20, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: false },
  basic:    { dailyResearchLimit: 10, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 5, knowledgeGraphAccess: false, exportAccess: false, jackalProtocol: false },
  free:     { dailyResearchLimit: 3, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 2, knowledgeGraphAccess: false, exportAccess: false, jackalProtocol: false },
};

async function getUserTier(userId: string): Promise<Tier> {
  const { data, error } = await supabase.from("profiles").select("tier").eq("id", userId).single();
  if (error || !data?.tier) return "basic";
  return (data.tier as Tier) ?? "basic";
}

function getTierConfig(tier: Tier): TierConfig {
  return TIER_CONFIG[tier] ?? TIER_CONFIG.basic;
}

async function getDailyUsage(userId: string, table: "research_runs" | "deep_dives"): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).gte("generated_at", startOfDay.toISOString());
  if (error) return 0;
  return count ?? 0;
}

function tierDenied(res: express.Response, message: string, upgradeHint?: string) {
  res.status(403).json({ error: "tier_limit", message, upgradeHint: upgradeHint ?? "Upgrade your plan at charonv1-silk.vercel.app/pricing" });
}

const REPORTS_DIR = join(process.cwd(), "reports");
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(join(REPORTS_DIR, "people"), { recursive: true });
mkdirSync(join(REPORTS_DIR, "products"), { recursive: true });
mkdirSync(join(REPORTS_DIR, "political"), { recursive: true });

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

app.post("/research", async (req, res) => {
  if (!authCheck(req, res)) return;

  const { subject, type, userId } = req.body;
  if (!subject || !type || !userId) {
    res.status(400).json({ error: "subject, type, and userId required" });
    return;
  }

  const tier = await getUserTier(userId);
  const config = getTierConfig(tier);

  if (type === "political" && !config.politicalAccess) {
    return tierDenied(res, "Political research requires Pro or higher.");
  }

  if (config.dailyResearchLimit !== -1) {
    const usage = await getDailyUsage(userId, "research_runs");
    if (usage >= config.dailyResearchLimit) {
      return tierDenied(res, `Daily research limit of ${config.dailyResearchLimit} reached.`);
    }
  }

  try {
    let bundle: unknown;
    let report: string;
    let outPath: string;

    const egg = findEasterEgg(subject);
    if (egg && egg.type === type) {
      report = egg.markdown;
      bundle = { query: subject, generatedAt: new Date().toISOString() };
      outPath = type === "person" ? join(REPORTS_DIR, "people", `${slugify(subject)}.md`) : type === "product" ? join(REPORTS_DIR, "products", `${slugify(subject)}.md`) : join(REPORTS_DIR, `${slugify(subject)}.md`);
    } else {
      const orchestrator = new ResearchOrchestrator();
      if (type === "company") {
        const result = await orchestrator.researchCompany(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, `${slugify(subject)}.md`);
      } else if (type === "person") {
        const result = await orchestrator.researchPerson(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "people", `${slugify(subject)}.md`);
      } else if (type === "political") {
        const result = await orchestrator.researchPerson(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "political", `${slugify(subject)}.md`);
      } else {
        const result = await orchestrator.researchProduct(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "products", `${slugify(subject)}.md`);
      }
    }

    writeFileSync(outPath, report, "utf-8");

    const runId = randomUUID();

    const { error } = await supabase.from("research_runs").insert({
      id: runId,
      user_id: userId,
      type,
      subject,
      generated_at: new Date().toISOString(),
      report_path: outPath,
      bundle: { ...(bundle as object), reportMarkdown: report },
    });

    if (error) {
      console.error("[research] Supabase insert error:", JSON.stringify(error));
      throw new Error(error.message);
    }

    res.json({ ok: true, reportPath: outPath, tier, jackal: config.jackalProtocol });

    if (type === "company" || type === "person" || type === "product" || type === "political") {
      const entityAgent = new EntityExtractionAgent();
      setTimeout(() => {
        entityAgent.extract(report, { name: subject, type })
          .then((extraction) => saveEntityExtraction(userId, runId, extraction))
          .catch((err) => console.error("[entity-extraction] failed:", err));
      }, 3000);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("[research] Error:", message);
    res.status(500).json({ error: message });
  }
});

app.post("/deep-dive", async (req, res) => {
  if (!authCheck(req, res)) return;

  const { company, userId } = req.body;
  if (!company || !userId) {
    res.status(400).json({ error: "company and userId required" });
    return;
  }

  const tier = await getUserTier(userId);
  const config = getTierConfig(tier);

  if (!config.deepDiveAccess) {
    return tierDenied(res, "Deep Dive requires Pro or higher.");
  }

  if (config.dailyDeepDiveLimit !== -1) {
    const usage = await getDailyUsage(userId, "deep_dives");
    if (usage >= config.dailyDeepDiveLimit) {
      return tierDenied(res, `Daily Deep Dive limit of ${config.dailyDeepDiveLimit} reached.`);
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const fetcher = new DirectFetchProvider();
    const searcher = new SerperSearchProvider();
    const agent = new DeepDiveAgent(fetcher, searcher);
    const bundle = await agent.run(company, send);

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

app.get("/tier/:userId", async (req, res) => {
  if (!authCheck(req, res)) return;
  const tier = await getUserTier(req.params.userId);
  const config = getTierConfig(tier);
  res.json({ tier, config });
});

app.get("/health", (_, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.listen(PORT, () => { console.log(`SELINE Agent Server running on port ${PORT}`); });