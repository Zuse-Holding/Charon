import { NextRequest } from "next/server";

/**
 * Simple in-memory per-IP sliding-window limiter for the auth proxy routes
 * (task 3.1: web/app/api/auth/signup, signin, reset-password). Same
 * ephemeral-serverless-memory caveat as the old research-endpoint limiter
 * (AUDIT.md) — Vercel serverless instances don't share memory, so this
 * throttles a sustained burst against one warm instance rather than
 * guaranteeing a hard global ceiling. Good enough for its actual job here
 * (slow down scripted signup/reset abuse), not a substitute for Supabase
 * Auth's own project-level rate limits, which still apply underneath this.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; resetInMs: number } {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, resetInMs: windowMs };
  }
  if (entry.count >= max) {
    return { allowed: false, resetInMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { allowed: true, resetInMs: entry.resetAt - now };
}
