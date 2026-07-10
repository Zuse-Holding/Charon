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

type Tier = "internal" | "team" | "pro" | "basic" | "free" | "trial";

interface TierConfig {
  dailyResearchLimit: number;
  dailyDeepDiveLimit: number;
  deepDiveAccess: boolean;
  politicalAccess: boolean;
  watchlistLimit: number;
  knowledgeGraphAccess: boolean;
  exportAccess: boolean;
  jackalProtocol: boolean;
  chatWidgetAccess: boolean;
}

const TIER_CONFIG: Record<Tier, TierConfig> = {
  internal: { dailyResearchLimit: -1, dailyDeepDiveLimit: -1, deepDiveAccess: true, politicalAccess: true, watchlistLimit: -1, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: true, chatWidgetAccess: true },
  team:     { dailyResearchLimit: 200, dailyDeepDiveLimit: 20, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 50, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: false, chatWidgetAccess: true },
  pro:      { dailyResearchLimit: 50, dailyDeepDiveLimit: 5, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 20, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: false, chatWidgetAccess: true },
  basic:    { dailyResearchLimit: 10, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 5, knowledgeGraphAccess: false, exportAccess: false, jackalProtocol: false, chatWidgetAccess: false },
  free:     { dailyResearchLimit: 3, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 2, knowledgeGraphAccess: false, exportAccess: false, jackalProtocol: false, chatWidgetAccess: false },
  // Time-boxed trial tier for external demo/feedback users (e.g. investor trials).
  // No political research, no Jackal Protocol, no chat widget (protects API cost
  // exposure on an unmetered-feeling trial). Expiry enforced via
  // profiles.trial_expires_at, checked in getUserTier below.
  trial:    { dailyResearchLimit: 30, dailyDeepDiveLimit: 10, deepDiveAccess: true, politicalAccess: false, watchlistLimit: 20, knowledgeGraphAccess: true, exportAccess: true, jackalProtocol: false, chatWidgetAccess: false },
};

/**
 * Looks up the user's tier. If the user is on "trial" and trial_expires_at
 * has passed, returns "expired" — a dead state with zero access — rather
 * than continuing to honor trial privileges. Every route that calls
 * getUserTier automatically respects expiry with no extra wiring.
 */
async function getUserTier(userId: string): Promise<Tier | "expired"> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tier, trial_expires_at")
    .eq("id", userId)
    .single();

  if (error || !data?.tier) return "basic";

  const tier = (data.tier as Tier) ?? "basic";

  if (tier === "trial" && data.trial_expires_at) {
    const expired = new Date() > new Date(data.trial_expires_at);
    if (expired) return "expired";
  }

  return tier;
}

const EXPIRED_CONFIG: TierConfig = {
  dailyResearchLimit: 0, dailyDeepDiveLimit: 0, deepDiveAccess: false,
  politicalAccess: false, watchlistLimit: 0, knowledgeGraphAccess: false,
  exportAccess: false, jackalProtocol: false, chatWidgetAccess: false,
};

function getTierConfig(tier: Tier | "expired"): TierConfig {
  if (tier === "expired") return EXPIRED_CONFIG;
  return TIER_CONFIG[tier] ?? TIER_CONFIG.basic;
}

async function getDailyUsage(userId: string, table: "research_runs" | "deep_dives"): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).gte("generated_at", startOfDay.toISOString());
  if (error) return 0;
  return count ?? 0;
}

/**
 * Person-search monthly limit — 25/month, separate from the daily research
 * limit. Scoped specifically to type === "person" requests. Internal tier
 * bypasses this the same way it bypasses every other limit.
 */
const PERSON_SEARCH_MONTHLY_LIMIT = 25;

async function getMonthlyPersonSearchCount(userId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("person_search_audit")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    console.error("[person-search-audit] count error:", JSON.stringify(error));
    return 0;
  }
  return count ?? 0;
}

async function logPersonSearch(userId: string, subject: string, ipAddress?: string) {
  const { error } = await supabase.from("person_search_audit").insert({
    id: randomUUID(),
    user_id: userId,
    query_target: subject,
    search_type: "person_research",
    ip_address: ipAddress ?? null,
  });
  if (error) {
    console.error("[person-search-audit] insert error:", JSON.stringify(error));
  }
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

  if (tier === "expired") {
    return tierDenied(res, "Your trial has ended. Contact us to continue using Charon.", "Contact hello@charon.example to discuss plans.");
  }

  if (type === "political" && !config.politicalAccess) {
    return tierDenied(res, "Political research requires Pro or higher.");
  }

  if (config.dailyResearchLimit !== -1) {
    const usage = await getDailyUsage(userId, "research_runs");
    if (usage >= config.dailyResearchLimit) {
      return tierDenied(res, `Daily research limit of ${config.dailyResearchLimit} reached.`);
    }
  }

  // Person-search specific monthly cap + audit trail. Internal tier bypasses
  // this entirely, same as every other limit.
  if (type === "person" && tier !== "internal") {
    const monthlyCount = await getMonthlyPersonSearchCount(userId);
    if (monthlyCount >= PERSON_SEARCH_MONTHLY_LIMIT) {
      return tierDenied(res, `Monthly person-research limit of ${PERSON_SEARCH_MONTHLY_LIMIT} reached.`);
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

    // Log person-search audit trail only after a successful run, and only
    // for non-internal users (internal bypasses the cap so no need to track).
    if (type === "person" && tier !== "internal") {
      const ipAddress = (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress;
      logPersonSearch(userId, subject, ipAddress).catch((err) =>
        console.error("[person-search-audit] failed:", err)
      );
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

  if (tier === "expired") {
    return tierDenied(res, "Your trial has ended. Contact us to continue using Charon.");
  }

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