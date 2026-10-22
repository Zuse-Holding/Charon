// Launch P1: daily cost per run and per user against plan revenue, from the
// cost columns every run writes (research_runs / deep_dives: cost_usd,
// model_cost_usd, search_calls). Run it daily for the first week of real
// traffic: `npm run cost-report` (last 7 days) or `npm run cost-report -- 14`.
// Read-only; needs the service-role key, so run it on the agent box.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DAYS = Number(process.argv[2]) || 7;
// Monthly list prices by tier (web pricing page). Internal and trial pay nothing.
const PRICE = { basic: 19, pro: 49, team: 149 };
// A Team user maxing out Deep Dives runs about 600 a month: above this
// average cost per Deep Dive, that user loses money.
const TEAM_DEEP_DIVE_BREAK_EVEN = PRICE.team / 600;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
const usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

async function rows(table) {
  // The split columns may not exist yet (migration not run): fall back.
  const full = await supabase.from(table).select("user_id, generated_at, cost_usd, model_cost_usd, search_calls").gte("generated_at", since);
  if (!full.error) return full.data;
  const basic = await supabase.from(table).select("user_id, generated_at, cost_usd").gte("generated_at", since);
  if (basic.error) throw new Error(`${table}: ${basic.error.message}`);
  return basic.data;
}

const [runs, dives, profiles] = await Promise.all([
  rows("research_runs"),
  rows("deep_dives"),
  supabase.from("profiles").select("id, display_name, tier").then((r) => r.data ?? []),
]);
const tierOf = new Map(profiles.map((p) => [p.id, p.tier ?? "free"]));
const nameOf = new Map(profiles.map((p) => [p.id, p.display_name ?? p.id.slice(0, 8)]));

function summarize(label, list) {
  const measured = list.filter((r) => r.cost_usd != null);
  const total = measured.reduce((s, r) => s + Number(r.cost_usd), 0);
  const model = measured.reduce((s, r) => s + Number(r.model_cost_usd ?? 0), 0);
  const searches = measured.reduce((s, r) => s + Number(r.search_calls ?? 0), 0);
  const avg = measured.length ? total / measured.length : 0;
  const split = measured.some((r) => r.model_cost_usd != null) ? ` (model ${usd(model)}, ${searches} searches)` : "";
  console.log(`  ${label}: ${list.length} run(s), ${measured.length} measured, total ${usd(total)}${split}, avg ${usd(avg)}/run`);
  return avg;
}

console.log(`\nCost report, last ${DAYS} day(s) (since ${since.slice(0, 10)})\n`);
console.log("By day");
const days = [...new Set([...runs, ...dives].map((r) => r.generated_at?.slice(0, 10)).filter(Boolean))].sort();
for (const d of days) {
  console.log(` ${d}`);
  summarize("Quick Profiles", runs.filter((r) => r.generated_at?.startsWith(d)));
  summarize("Deep Dives", dives.filter((r) => r.generated_at?.startsWith(d)));
}

console.log("\nWhole window");
summarize("Quick Profiles", runs);
const teamDives = dives.filter((r) => tierOf.get(r.user_id) === "team");
const diveAvg = summarize("Deep Dives", dives);
if (diveAvg > TEAM_DEEP_DIVE_BREAK_EVEN) {
  console.log(`  ! Average Deep Dive cost ${usd(diveAvg)} is above the Team break-even of ${usd(TEAM_DEEP_DIVE_BREAK_EVEN)} (600 a month at $${PRICE.team}).`);
}
if (teamDives.length) summarize("Team-plan Deep Dives", teamDives);

console.log("\nBy user (cost vs plan revenue for the window)");
const users = new Map();
for (const [kind, list] of [["runs", runs], ["dives", dives]]) {
  for (const r of list) {
    const u = users.get(r.user_id) ?? { runs: 0, dives: 0, cost: 0 };
    u[kind] += 1;
    u.cost += Number(r.cost_usd ?? 0);
    users.set(r.user_id, u);
  }
}
const sorted = [...users.entries()].sort((a, b) => b[1].cost - a[1].cost);
for (const [id, u] of sorted) {
  const tier = tierOf.get(id) ?? "unknown";
  const revenue = ((PRICE[tier] ?? 0) / 30) * DAYS;
  const margin = revenue - u.cost;
  const flag = PRICE[tier] && margin < 0 ? "  ! losing money" : "";
  console.log(`  ${nameOf.get(id) ?? id} [${tier}] ${u.runs} profile(s), ${u.dives} deep dive(s): cost ${usd(u.cost)}, revenue ${usd(revenue)}, margin ${usd(margin)}${flag}`);
}
if (sorted.length === 0) console.log("  No runs in this window.");
