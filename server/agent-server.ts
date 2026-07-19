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
import { OpenCorporatesAgent } from "../src/agents/opencorporates-agent/index.js";
import { OpenFecAgent } from "../src/agents/openfec-agent/index.js";
import { CourtListenerAgent } from "../src/agents/courtlistener-agent/index.js";
import { MuckRockAgent } from "../src/agents/muckrock-agent/index.js";
import { findEasterEgg } from "../src/easter-eggs/index.js";
import { saveEntityExtraction } from "../src/database/knowledge-graph.js";
import { upsertStatewideExecutives } from "../src/database/statewide-executives.js";
import { DirectFetchProvider, SerperSearchProvider } from "../src/lib/providers.js";
import { parsePersonQuery } from "../src/lib/nlp.js";
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

// Political access allowlist — demo safety net on top of tier config.
// Tier config alone (politicalAccess: true on internal/team/pro) means
// ANY account you set to team/pro for a demo, or any tier misconfig,
// would get political search too. This is a second, explicit gate:
// even if config.politicalAccess is true, political research is denied
// unless the userId is also in this set. Add your own Supabase user
// UUID here (Dashboard → Authentication → Users) before demoing —
// until you do, this is empty and has no effect (falls back to
// tier-only gating, same as before).
const POLITICAL_ACCESS_USER_IDS = new Set<string>([
  "251f3f4f-9878-4264-8335-2c191a937428", // Nick — superuser/internal account
]);

function hasPoliticalAccess(userId: string, config: TierConfig): boolean {
  if (!config.politicalAccess) return false;
  if (POLITICAL_ACCESS_USER_IDS.size === 0) return true; // not configured yet — tier-only gating
  return POLITICAL_ACCESS_USER_IDS.has(userId);
}

type Tier = "internal" | "team" | "pro" | "basic" | "free" | "trial";

interface TierConfig {
  dailyResearchLimit: number;
  dailyDeepDiveLimit: number;
  deepDiveAccess: boolean;
  politicalAccess: boolean;
  watchlistLimit: number;
  knowledgeGraphAccess: boolean;
  exportAccess: boolean;
  charonProtocol: boolean;
  chatWidgetAccess: boolean;
  // Charon-only UI buttons (dashboard "Charon Tools" row + Admin tab) —
  // separate flags rather than reusing charonProtocol so each can be
  // tuned independently later, even though all three are internal-only
  // today.
  personResearchAccess: boolean;
  muckrockAccess: boolean;
  adminAccess: boolean;
  // 7/17 weekend list #1: hard monthly cap on quick profiles (company/
  // person/product/political — anything in research_runs, separate from
  // the existing person-specific 25/month limit below), scoped to Basic
  // only. -1 = unlimited. Resets on the account's billing anniversary,
  // not the calendar month — see getBillingPeriodStart.
  monthlyResearchLimit: number;
}

const TIER_CONFIG: Record<Tier, TierConfig> = {
  internal: { dailyResearchLimit: -1, dailyDeepDiveLimit: -1, deepDiveAccess: true, politicalAccess: true, watchlistLimit: -1, knowledgeGraphAccess: true, exportAccess: true, charonProtocol: true, chatWidgetAccess: true, personResearchAccess: true, muckrockAccess: true, adminAccess: true, monthlyResearchLimit: -1 },
  team:     { dailyResearchLimit: 200, dailyDeepDiveLimit: 20, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 50, knowledgeGraphAccess: true, exportAccess: true, charonProtocol: false, chatWidgetAccess: true, personResearchAccess: false, muckrockAccess: false, adminAccess: false, monthlyResearchLimit: -1 },
  pro:      { dailyResearchLimit: 50, dailyDeepDiveLimit: 5, deepDiveAccess: true, politicalAccess: true, watchlistLimit: 20, knowledgeGraphAccess: true, exportAccess: true, charonProtocol: false, chatWidgetAccess: true, personResearchAccess: false, muckrockAccess: false, adminAccess: false, monthlyResearchLimit: -1 },
  basic:    { dailyResearchLimit: 10, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 5, knowledgeGraphAccess: false, exportAccess: false, charonProtocol: false, chatWidgetAccess: false, personResearchAccess: false, muckrockAccess: false, adminAccess: false, monthlyResearchLimit: 25 },
  free:     { dailyResearchLimit: 3, dailyDeepDiveLimit: 0, deepDiveAccess: false, politicalAccess: false, watchlistLimit: 2, knowledgeGraphAccess: false, exportAccess: false, charonProtocol: false, chatWidgetAccess: false, personResearchAccess: false, muckrockAccess: false, adminAccess: false, monthlyResearchLimit: -1 },
  // Time-boxed tier for external demo/partner accounts (limited partners,
  // investor trials, etc). Deliberately mirrors "team" limits and features
  // so the demo shows the platform at full strength — the ONLY things it
  // withholds are politicalAccess and charonProtocol, which stay off
  // regardless of what tier gets requested for these accounts. Expiry
  // enforced via profiles.trial_expires_at, checked in getUserTier below.
  trial:    { dailyResearchLimit: 200, dailyDeepDiveLimit: 20, deepDiveAccess: true, politicalAccess: false, watchlistLimit: 50, knowledgeGraphAccess: true, exportAccess: true, charonProtocol: false, chatWidgetAccess: true, personResearchAccess: false, muckrockAccess: false, adminAccess: false, monthlyResearchLimit: -1 },
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
  exportAccess: false, charonProtocol: false, chatWidgetAccess: false,
  personResearchAccess: false, muckrockAccess: false, adminAccess: false,
  monthlyResearchLimit: 0,
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

/**
 * 7/17 weekend list #1 — Basic-tier hard cap of 25 "quick profiles" per
 * month, across ALL research types (company/person/product/political),
 * distinct from PERSON_SEARCH_MONTHLY_LIMIT above (which only covers
 * type === "person" and applies to every non-internal tier on a calendar-
 * month reset). This one resets on the account's *billing anniversary*
 * instead — there's no real subscription/billing system in this codebase
 * (no Stripe, no subscription-start column anywhere), so account creation
 * date (auth.users.created_at) is used as the anniversary-date proxy: the
 * period always starts on the same day-of-month the account was created,
 * most recently in the past relative to now.
 */
async function getBillingPeriodStart(userId: string): Promise<Date> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  const createdAt = data?.user?.created_at ? new Date(data.user.created_at) : null;

  if (error || !createdAt || isNaN(createdAt.getTime())) {
    // Fallback: if we can't resolve account creation date for any reason,
    // fall back to calendar-month reset rather than failing the request.
    const fallback = new Date();
    fallback.setDate(1);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  const anniversaryDay = createdAt.getDate();
  const now = new Date();

  // Start with this calendar month's anniversary date, clamped to the
  // month's actual last day (handles e.g. created on the 31st in a
  // 30-day month) via the Date rollover -> re-clamp pattern below.
  let periodStart = new Date(now.getFullYear(), now.getMonth(), anniversaryDay, 0, 0, 0, 0);
  if (periodStart.getMonth() !== now.getMonth()) {
    // Rolled into the next month (e.g. asked for Feb 31) — clamp to the
    // last day of the intended month instead.
    periodStart = new Date(now.getFullYear(), now.getMonth() + 1, 0, 0, 0, 0, 0);
  }

  if (periodStart > now) {
    // This month's anniversary hasn't happened yet — use last month's.
    const prevMonth = now.getMonth() - 1;
    periodStart = new Date(now.getFullYear(), prevMonth, anniversaryDay, 0, 0, 0, 0);
    if (periodStart.getMonth() !== ((prevMonth + 12) % 12)) {
      periodStart = new Date(now.getFullYear(), prevMonth + 1, 0, 0, 0, 0, 0);
    }
  }

  return periodStart;
}

async function getMonthlyResearchUsage(userId: string, periodStart: Date): Promise<number> {
  const { count, error } = await supabase
    .from("research_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("generated_at", periodStart.toISOString());
  if (error) {
    console.error("[monthly-research-usage] count error:", JSON.stringify(error));
    return 0;
  }
  return count ?? 0;
}

function tierDenied(res: express.Response, message: string, upgradeHint?: string) {
  res.status(403).json({ error: "tier_limit", message, upgradeHint: upgradeHint ?? "Upgrade your plan at metisanalytic.com/pricing" });
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

  const { subject: rawSubject, type, userId } = req.body;
  if (!rawSubject || !type || !userId) {
    res.status(400).json({ error: "subject, type, and userId required" });
    return;
  }

  // 7/17 weekend list #5 — split "Daniel Olmos csun" into a clean name
  // ("Daniel Olmos") plus an affiliation ("csun") for person searches.
  // `subject` is reassigned to the clean name here, at the top of the
  // route, so every downstream use of it (report path/slug, research_runs
  // row, person-search audit log, KG entity seed name) is already clean
  // with no further changes needed below. Affiliation is threaded
  // separately into orchestrator.researchPerson for search context.
  let subject: string = rawSubject;
  let personAffiliation: string | undefined;
  if (type === "person") {
    const parsed = parsePersonQuery(rawSubject);
    subject = parsed.name;
    personAffiliation = parsed.affiliation;
  }

  const tier = await getUserTier(userId);
  const config = getTierConfig(tier);

  if (tier === "expired") {
    return tierDenied(res, "Your trial has ended. Contact us to continue using Metis.", "Contact support@metisanalytic.com to discuss plans.");
  }

  if (type === "political" && !hasPoliticalAccess(userId, config)) {
    // Generic message on purpose — if the allowlist is what's blocking
    // this (not tier), "requires Pro or higher" would be misleading for
    // an account that's actually already on Pro/Team.
    return tierDenied(res, "Political research is not enabled for this account.");
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

  // 7/17 weekend list #1 — Basic-tier hard cap of 25 quick profiles/month
  // across all research types, resetting on the account's billing
  // anniversary (see getBillingPeriodStart). Separate from, and stacks
  // with, the person-only cap above — a Basic user doing person research
  // can still be blocked by whichever limit they hit first.
  if (config.monthlyResearchLimit !== -1) {
    const periodStart = await getBillingPeriodStart(userId);
    const monthlyUsage = await getMonthlyResearchUsage(userId, periodStart);
    if (monthlyUsage >= config.monthlyResearchLimit) {
      return tierDenied(
        res,
        `Monthly limit of ${config.monthlyResearchLimit} quick profiles reached. Resets ${new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate()).toLocaleDateString()}.`,
        "Upgrade to Pro for unlimited quick profiles."
      );
    }
  }

  // Background-persistent search — insert the row up front, before any
  // research runs, so its existence (status: 'pending') survives even if
  // this request's client disconnects. The research itself keeps running
  // regardless (nothing here aborts on client disconnect); this just makes
  // that in-progress state visible so the web app can resume showing
  // progress after a reload instead of losing track of it. Best-effort —
  // a failed insert here shouldn't block the actual research request.
  const runId = randomUUID();
  const { error: pendingError } = await supabase.from("research_runs").insert({
    id: runId,
    user_id: userId,
    type,
    subject,
    generated_at: new Date().toISOString(),
    status: "pending",
  });
  if (pendingError) {
    console.error("[research] Failed to insert pending run:", JSON.stringify(pendingError));
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
      // Charon Protocol (internal tier only): deeper sourcing on person/
      // political research, on top of the unlimited quotas internal
      // already gets everywhere else in this file.
      const deep = tier === "internal";

      if (type === "company") {
        const result = await orchestrator.researchCompany(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, `${slugify(subject)}.md`);
      } else if (type === "person") {
        const result = await orchestrator.researchPerson(subject, deep, personAffiliation);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "people", `${slugify(subject)}.md`);
      } else if (type === "political") {
        // Was a stub that silently ran regular person research and
        // mislabeled it "political" — now runs the real political-agent
        // (opposition research, district makeup, approval rating, voting
        // record, campaign finance).
        const result = await orchestrator.researchPolitical(subject, deep);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "political", `${slugify(subject)}.md`);
      } else {
        const result = await orchestrator.researchProduct(subject);
        bundle = result.bundle; report = result.report;
        outPath = join(REPORTS_DIR, "products", `${slugify(subject)}.md`);
      }
    }

    writeFileSync(outPath, report, "utf-8");

    const { error } = await supabase
      .from("research_runs")
      .update({
        generated_at: new Date().toISOString(),
        report_path: outPath,
        bundle: { ...(bundle as object), reportMarkdown: report },
        status: "completed",
      })
      .eq("id", runId);

    if (error) {
      console.error("[research] Supabase update error:", JSON.stringify(error));
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

    res.json({ ok: true, runId, reportPath: outPath, tier, charon: config.charonProtocol });

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
    await supabase.from("research_runs").update({ status: "failed", error: message }).eq("id", runId);
    res.status(500).json({ error: message });
  }
});

/**
 * Person Research (Charon) — the standalone cross-reference tool behind
 * the dashboard's "Person Research" button, distinct from the general
 * /research?type=person report-generation flow above (that one still
 * runs OpenCorporates + MuckRock automatically for internal tier; this
 * endpoint is a separate, structured, on-demand lookup, not a report).
 *
 * Charon-only: the whole endpoint 403s below internal tier, not just a
 * `deep` flag on top of it — there's no reduced version of this for
 * other tiers.
 *
 * Four sources per the spec: OpenCorporates and FEC cross-reference are
 * real (existing agents, this just wires FEC into a person lookup for
 * the first time). CourtListener is a real new integration (free RECAP
 * search — the closest no-cost mirror of PACER). PACER and Form 4 come
 * back as explicit "not available" placeholders — and PERMANENTLY so,
 * not a "coming soon":
 *   - PACER has no free/keyless API at all. The only way in is a paid,
 *     individually-registered CM/ECF account with per-page billing.
 *     There is nothing to "finish building" here without that account.
 *   - Form 4 (SEC insider filings) already exists in this codebase, but
 *     keyed by COMPANY name (src/agents/form4-agent — "is this person an
 *     insider of THIS company"). A person-first query is a genuinely
 *     different lookup (search across every company for this person),
 *     not a missing wire-up of the existing agent — reusing form4-agent
 *     as-is here would produce a nonsensical prompt, not a shortcut.
 * Building either for real is a scoped v2 project (PACER: get
 * credentials; Form 4: a new person-keyed agent), not a bug fix — don't
 * spend time on either without a credential to build against.
 */
app.post("/person-research/deep", async (req, res) => {
  if (!authCheck(req, res)) return;

  const { userId, name } = req.body;
  if (!userId || !name) {
    res.status(400).json({ error: "userId and name required" });
    return;
  }

  const tier = await getUserTier(userId);
  if (tier !== "internal") {
    return tierDenied(res, "Person Research is a Charon-tier feature.");
  }

  try {
    const [openCorporates, fec, courtListener] = await Promise.all([
      new OpenCorporatesAgent(new SerperSearchProvider(), new DirectFetchProvider()).run(name),
      new OpenFecAgent().run(name),
      new CourtListenerAgent().run(name),
    ]);

    res.json({
      name,
      generatedAt: new Date().toISOString(),
      openCorporates: { affiliations: openCorporates.affiliations, sources: openCorporates.sources },
      fec: { summary: fec.summary, donorBreakdown: fec.donorBreakdown, sources: fec.sources },
      courtListener: { records: courtListener.records, sources: courtListener.sources },
      form4: {
        available: false,
        reason: "Permanently unavailable, not a gap to fill in: Form 4 lookup in this codebase is keyed by company name, not person — a person-first query is a different lookup, not a missing wire-up.",
      },
      pacer: {
        available: false,
        reason: "Permanently unavailable, not a gap to fill in: PACER has no free public API — only a paid, individually-registered account. CourtListener's RECAP archive above mirrors much of its federal docket data for free.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("[person-research/deep] Error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * MuckRock FOIA Search (Charon) — direct, user-driven search of
 * MuckRock's public FOIA-request archive. Distinct from the automatic
 * MuckRock pull inside deep person/political research: this lets a
 * Charon user search any query (agency name, topic, org — not just a
 * person) on demand.
 */
app.post("/muckrock/search", async (req, res) => {
  if (!authCheck(req, res)) return;

  const { userId, query } = req.body;
  if (!userId || !query) {
    res.status(400).json({ error: "userId and query required" });
    return;
  }

  const tier = await getUserTier(userId);
  if (tier !== "internal") {
    return tierDenied(res, "MuckRock FOIA Search is a Charon-tier feature.");
  }

  try {
    const result = await new MuckRockAgent().run(query);
    res.json({ query, generatedAt: new Date().toISOString(), requests: result.requests, sources: result.sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("[muckrock/search] Error:", message);
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
    return tierDenied(res, "Your trial has ended. Contact us to continue using Metis.");
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", req.params.userId)
    .single();

  // Reflect the real, allowlist-aware political access here too — not
  // just tier config — so the frontend's "POL" pill hides itself for
  // any account the allowlist blocks, instead of being clickable and
  // then failing on submit. Same check /research enforces server-side;
  // this is just so the UI doesn't advertise something it'll refuse.
  const effectiveConfig = { ...config, politicalAccess: hasPoliticalAccess(req.params.userId, config) };

  // 7/17 weekend list #2 — expose the Basic-tier monthly quick-profile
  // usage so Settings can show "X/25 used this month" ahead of the user
  // hitting the hard block. Only computed when the tier actually has a
  // cap (-1 means unlimited, e.g. Pro/Team/internal) to avoid an extra
  // auth.admin lookup + count query on every /tier call for most users.
  let monthlyUsage: { used: number; limit: number; resetsAt: string } | null = null;
  if (config.monthlyResearchLimit !== -1) {
    const periodStart = await getBillingPeriodStart(req.params.userId);
    const used = await getMonthlyResearchUsage(req.params.userId, periodStart);
    const resetsAt = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate());
    monthlyUsage = { used, limit: config.monthlyResearchLimit, resetsAt: resetsAt.toISOString() };
  }

  res.json({ tier, config: effectiveConfig, displayName: profile?.display_name ?? null, monthlyUsage });
});

const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Lets a user set a preferred display name (e.g. "Nick") instead of the
 * app deriving one from their email locally on the client. Writes go
 * through the service-role key here rather than a direct browser
 * Supabase call — same pattern as every other profile read in this file.
 */
app.patch("/profile/:userId", async (req, res) => {
  if (!authCheck(req, res)) return;

  const raw = req.body?.displayName;
  if (raw !== null && typeof raw !== "string") {
    res.status(400).json({ error: "displayName must be a string or null" });
    return;
  }

  const trimmed = typeof raw === "string" ? raw.trim() : null;
  if (trimmed && trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    res.status(400).json({ error: `displayName must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer` });
    return;
  }

  // Empty string -> null, so clearing the field falls back to the
  // email-derived name instead of storing/displaying blank text.
  const displayName = trimmed || null;

  // Update first, then only insert if nothing matched. Deliberately not
  // using .upsert(onConflict:"id") here — that requires Postgres to already
  // have a unique/primary-key constraint registered on "id", and if this
  // profiles table doesn't actually have one, upsert fails outright rather
  // than falling back to update. This two-step version works regardless.
  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", req.params.userId)
    .select("id");

  if (updateError) {
    console.error("[profile] display_name update failed:", JSON.stringify(updateError));
    res.status(500).json({ error: `Failed to update display name: ${updateError.message}` });
    return;
  }

  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase
      .from("profiles")
      .insert({ id: req.params.userId, display_name: displayName });

    if (insertError) {
      console.error("[profile] display_name insert failed:", JSON.stringify(insertError));
      res.status(500).json({ error: `Failed to update display name: ${insertError.message}` });
      return;
    }
  }

  res.json({ ok: true, displayName });
});

/**
 * Admin stats snapshot (internal tier only). The Dashboard's Admin tab
 * has had a full UI for this since an earlier session — it's just been
 * calling a route that never existed (the 404 in tonight's bug log).
 * Built to match exactly what that UI already expects.
 */
app.get("/admin/stats/:userId", async (req, res) => {
  if (!authCheck(req, res)) return;

  const tier = await getUserTier(req.params.userId);
  if (tier !== "internal") {
    res.status(403).json({ error: "Admin stats require Charon tier" });
    return;
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayIso = startOfDay.toISOString();

  try {
    const [profilesResult, runsTodayResult, deepDivesTodayResult] = await Promise.all([
      supabase.from("profiles").select("tier"),
      supabase
        .from("research_runs")
        .select("id", { count: "exact", head: true })
        .gte("generated_at", startOfDayIso),
      supabase
        .from("deep_dives")
        .select("duration_ms")
        .gte("generated_at", startOfDayIso),
    ]);

    const tierBreakdownMap = new Map<string, number>();
    for (const row of profilesResult.data ?? []) {
      const t = (row.tier as string) ?? "basic";
      tierBreakdownMap.set(t, (tierBreakdownMap.get(t) ?? 0) + 1);
    }
    const tierBreakdown = [...tierBreakdownMap.entries()].map(([tier, count]) => ({ tier, count }));

    const durations = (deepDivesTodayResult.data ?? [])
      .map((r) => r.duration_ms as number | null)
      .filter((d): d is number => typeof d === "number");
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : 0;

    res.json({
      totalUsers: profilesResult.data?.length ?? 0,
      tierBreakdown,
      runsToday: runsTodayResult.count ?? 0,
      deepDivesToday: deepDivesTodayResult.data?.length ?? 0,
      // Not tracked yet — no "in progress" state is persisted anywhere
      // (deep_dives rows are only written after completion). Returning 0
      // honestly rather than faking a number; real tracking would need
      // either an in-memory counter here or a started_at/status column.
      deepDivesRunning: 0,
      avgDurationMs,
    });
  } catch (err) {
    console.error("[admin-stats] query failed:", err);
    res.status(500).json({ error: "Failed to load admin stats" });
  }
});

/**
 * Manual quarterly refresh for the statewide_executives table (Charon-
 * only, next to /admin/stats). Deliberately not a live scrape — the
 * admin supplies reviewed data (state/office/name/party/termStart/
 * sourceUrl), same trust model as the seed SQL files. See
 * upsertStatewideExecutives in src/database/statewide-executives.ts.
 */
app.post("/admin/statewide-executives/refresh", async (req, res) => {
  if (!authCheck(req, res)) return;

  const { userId, updates } = req.body;
  if (!userId || !Array.isArray(updates) || updates.length === 0) {
    res.status(400).json({ error: "userId and a non-empty updates array required" });
    return;
  }

  const tier = await getUserTier(userId);
  if (tier !== "internal") {
    res.status(403).json({ error: "Statewide-executives refresh requires Charon tier" });
    return;
  }

  const result = await upsertStatewideExecutives(updates);
  if (!result.ok) {
    res.status(500).json({ error: result.error ?? "Upsert failed" });
    return;
  }
  res.json({ ok: true, upserted: result.upserted });
});

app.get("/health", (_, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.listen(PORT, () => { console.log(`SELINE Agent Server running on port ${PORT}`); });