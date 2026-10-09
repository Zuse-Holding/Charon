import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEnabled } from "../src/lib/flags.js";
import { ExclusionGuard, ExclusionService, NOT_AVAILABLE, hashKey, limitFor, type AddInput } from "../src/lib/exclusions/index.js";
import { LiveMessenger, SupabaseExclusionStore } from "../src/lib/exclusions/adapters.js";

/**
 * Self-exclusion (Feature 6) endpoints, behind FEATURE_SELF_EXCLUSION.
 * Called only by the web app's API routes (x-agent-secret), which supply
 * the signed-in user's id. The confirm endpoint takes the emailed token
 * as its only credential.
 */

interface Deps {
  supabase: SupabaseClient;
  authCheck: (req: express.Request, res: express.Response) => boolean;
  getUserTier: (userId: string) => Promise<string>;
  checkHourlyBucket: (key: string, max: number) => { allowed: boolean; resetInMs: number };
  frontendUrl: string;
}

let guard: ExclusionGuard | undefined;

/** For search routes: true when the query names an excluded identifier.
 *  Off, or misconfigured: never blocks (and says so in the log). */
export async function searchBlocked(supabase: SupabaseClient, query: string): Promise<boolean> {
  if (!isEnabled("self_exclusion")) return false;
  try {
    guard ??= new ExclusionGuard(new SupabaseExclusionStore(supabase), hashKey());
    return await guard.blocksQuery(query);
  } catch (err) {
    console.error("[exclusions] search check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** The neutral response for a blocked search: same shape as any other
 *  unavailable search, nothing about why. */
export function notAvailable(res: express.Response) {
  res.status(404).json({ error: "not_available", message: NOT_AVAILABLE });
}

export function registerExclusionRoutes(app: express.Express, d: Deps) {
  let service: ExclusionService | undefined;
  const getService = () => (service ??= new ExclusionService(
    new SupabaseExclusionStore(d.supabase),
    new LiveMessenger(),
    hashKey(),
    (token) => `${d.frontendUrl.replace(/\/$/, "")}/exclusion-confirm?token=${token}`,
  ));

  const gate = (req: express.Request, res: express.Response): boolean => {
    if (!d.authCheck(req, res)) return false;
    if (!isEnabled("self_exclusion")) {
      res.status(404).json({ error: "not_found" });
      return false;
    }
    return true;
  };

  const fail = (res: express.Response, err: unknown) => {
    console.error("[exclusions]", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Something went wrong. Try again." });
  };

  app.get("/exclusions/:userId", async (req, res) => {
    if (!gate(req, res)) return;
    try {
      const tier = await d.getUserTier(req.params.userId);
      const entries = await getService().list(req.params.userId);
      res.json({ entries, limit: limitFor(tier), kinds: getService().kinds() });
    } catch (err) { fail(res, err); }
  });

  app.post("/exclusions/add", async (req, res) => {
    if (!gate(req, res)) return;
    const { userId, kind, value, attest } = req.body ?? {};
    if (!userId || !["email", "phone", "name_dob"].includes(kind)) {
      res.status(400).json({ error: "userId and kind required" });
      return;
    }
    const limit = d.checkHourlyBucket(`exclusion-add:${userId}`, 10);
    if (!limit.allowed) {
      res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(limit.resetInMs / 60000)} minutes.` });
      return;
    }
    try {
      const tier = await d.getUserTier(userId);
      const { data } = await d.supabase.auth.admin.getUserById(userId);
      const input = { kind, value, attest: attest === true } as AddInput;
      const result = await getService().add(userId, data?.user?.email ?? undefined, tier, input);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  app.post("/exclusions/verify-code", async (req, res) => {
    if (!gate(req, res)) return;
    const { userId, entryId, phone, code } = req.body ?? {};
    if (!userId || !entryId || typeof phone !== "string" || typeof code !== "string") {
      res.status(400).json({ error: "userId, entryId, phone and code required" });
      return;
    }
    const limit = d.checkHourlyBucket(`exclusion-code:${userId}`, 20);
    if (!limit.allowed) {
      res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(limit.resetInMs / 60000)} minutes.` });
      return;
    }
    try {
      const result = await getService().confirmCode(userId, entryId, phone, code);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) { fail(res, err); }
  });

  app.post("/exclusions/confirm", async (req, res) => {
    if (!gate(req, res)) return;
    const token = req.body?.token;
    try {
      const ok = typeof token === "string" && (await getService().confirmLink(token));
      res.status(ok ? 200 : 400).json({ ok });
    } catch (err) { fail(res, err); }
  });

  app.post("/exclusions/remove", async (req, res) => {
    if (!gate(req, res)) return;
    const { userId, entryId } = req.body ?? {};
    if (!userId || !entryId) {
      res.status(400).json({ error: "userId and entryId required" });
      return;
    }
    try {
      const removed = await getService().remove(userId, entryId);
      res.status(removed ? 200 : 404).json({ ok: removed });
    } catch (err) { fail(res, err); }
  });
}
