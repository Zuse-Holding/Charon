/**
 * Spend alerts: an email to ADMIN_EMAIL when one report costs more than
 * expected, or when today's model spend crosses the daily line. Cost per
 * report is already recorded (research_runs.cost_usd, deep_dives.cost_usd);
 * this only makes a spike visible before the invoice does.
 *
 * The daily alert fires on the report that crosses the line (spend before
 * it under, after it at or over), so no state is kept and a restart can't
 * resend it. Two reports finishing at the same moment can both send it;
 * that's the cost of keeping no state.
 *
 * Totals are a floor: models missing from model-pricing.ts count as $0,
 * and failed runs save no cost.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email/send.js";

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : fallback;
};

// About 10x the most expensive report so far (Oct 2026: average $0.003, max $0.01).
export const SPEND_LIMITS = {
  perReportUsd: num(process.env.ALERT_REPORT_COST_USD, 0.1),
  dailyUsd: num(process.env.ALERT_DAILY_COST_USD, 5),
};

export interface SpendAlert {
  subject: string;
  text: string;
}

/** Which alerts this report triggers. Pure, for tests. */
export function spendAlerts(
  report: { kind: string; subject: string; costUsd: number },
  spentTodayUsd: number,
  limits = SPEND_LIMITS,
): SpendAlert[] {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const out: SpendAlert[] = [];
  if (report.costUsd >= limits.perReportUsd) {
    out.push({
      subject: `Metis spend: one report cost ${usd(report.costUsd)}`,
      text: `A ${report.kind} on "${report.subject}" cost ${usd(report.costUsd)} in model calls, over the ${usd(limits.perReportUsd)} alert line.\n\nToday so far: ${usd(spentTodayUsd)}.`,
    });
  }
  const before = spentTodayUsd - report.costUsd;
  if (before < limits.dailyUsd && spentTodayUsd >= limits.dailyUsd) {
    out.push({
      subject: `Metis spend: ${usd(spentTodayUsd)} today`,
      text: `Model spend today (UTC) reached ${usd(spentTodayUsd)}, over the ${usd(limits.dailyUsd)} daily alert line. You'll get this once a day.`,
    });
  }
  return out;
}

async function spentToday(supabase: SupabaseClient): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const iso = since.toISOString();
  const [runs, dives] = await Promise.all([
    supabase.from("research_runs").select("cost_usd").gte("generated_at", iso),
    supabase.from("deep_dives").select("cost_usd").gte("generated_at", iso),
  ]);
  if (runs.error || dives.error) throw new Error((runs.error ?? dives.error)!.message);
  return [...(runs.data ?? []), ...(dives.data ?? [])].reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
}

/** Call after a report's cost is saved. Never throws: an alert failing
 *  must not fail the report. */
export async function checkSpend(
  supabase: SupabaseClient,
  report: { kind: string; subject: string; costUsd: number | null | undefined },
): Promise<void> {
  try {
    const costUsd = report.costUsd ?? 0;
    const alerts = spendAlerts({ ...report, costUsd }, await spentToday(supabase));
    const to = process.env.ADMIN_EMAIL;
    for (const a of alerts) {
      console.warn(`[spend] ${a.subject}`);
      if (to) await sendEmail({ to, subject: a.subject, text: a.text });
    }
    if (alerts.length && !to) console.warn("[spend] ADMIN_EMAIL not set, so the alert above wasn't emailed");
  } catch (err) {
    console.error("[spend] check failed:", err instanceof Error ? err.message : err);
  }
}
