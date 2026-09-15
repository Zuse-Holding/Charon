// Task B (pre-launch) — grants every account created before DEPLOY_DATE a
// time-boxed Pro grace period, after which they fall to Free (enforced by
// getUserTier() in server/agent-server.ts via profiles.pro_grace_expires_at
// — see that function's doc comment and supabase/schema.sql).
//
// SAFE BY DEFAULT: dry-run unless --apply is passed. Prints exactly who
// would be affected either way. Per the ask, this script is written but
// NOT run automatically by anything — a human runs it deliberately.
//
// Usage:
//   DEPLOY_DATE=2026-09-20 node grant-legacy-pro-grace.mjs                # dry run
//   DEPLOY_DATE=2026-09-20 GRACE_PERIOD_DAYS=30 node grant-legacy-pro-grace.mjs --apply
//
// Excluded from the grant (never touched, regardless of signup date):
//   - internal / trial / team tier accounts — not the audience for this,
//     and clobbering an internal/Charon account's tier would be a real
//     problem, not just a wasted grant.
//   - anyone who already has a stripe_customer_id — already a real Stripe
//     customer (paying or mid-checkout); this migration is for accounts
//     that predate billing entirely, not to overwrite existing state.
//
// The grace period is counted from when this script actually RUNS (now),
// not from DEPLOY_DATE — DEPLOY_DATE is only the created_at cutoff for
// who qualifies. Running this a few days after the actual deploy still
// gives every qualifying account a full grace window from that point,
// which seemed fairer than backdating it to a date that may have already
// partly elapsed by the time someone runs this.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const DEPLOY_DATE = process.env.DEPLOY_DATE;
const GRACE_PERIOD_DAYS = Number(process.env.GRACE_PERIOD_DAYS ?? 30);

if (!DEPLOY_DATE || isNaN(new Date(DEPLOY_DATE).getTime())) {
  console.error("Set DEPLOY_DATE to a real date (e.g. DEPLOY_DATE=2026-09-20). Aborting.");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROTECTED_TIERS = new Set(["internal", "trial", "team"]);
const cutoff = new Date(DEPLOY_DATE);
const graceExpiresAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

// Paginate through every auth user, same pattern as the read-only account
// count run earlier this session.
let allUsers = [];
let page = 1;
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error("listUsers failed:", error); process.exit(1); }
  allUsers = allUsers.concat(data.users);
  if (data.users.length < 1000) break;
  page++;
}

const { data: profiles, error: profilesErr } = await supabase
  .from("profiles")
  .select("id, tier, stripe_customer_id");
if (profilesErr) {
  if (profilesErr.code === "42703") {
    console.error(
      "profiles.stripe_customer_id doesn't exist yet — run the \"Stripe / billing (Phase 1)\" " +
      "migration block in supabase/schema.sql (Supabase SQL Editor) first."
    );
  } else {
    console.error("profiles fetch failed:", profilesErr);
  }
  process.exit(1);
}
const profileById = new Map(profiles.map((p) => [p.id, p]));

const eligible = [];
const skipped = [];

for (const user of allUsers) {
  const createdAt = new Date(user.created_at);
  if (createdAt >= cutoff) continue; // not "before DEPLOY_DATE" — not in scope at all

  const profile = profileById.get(user.id);
  const tier = profile?.tier ?? "free";

  if (PROTECTED_TIERS.has(tier)) {
    skipped.push({ email: user.email, reason: `protected tier (${tier})` });
    continue;
  }
  if (profile?.stripe_customer_id) {
    skipped.push({ email: user.email, reason: "already a Stripe customer" });
    continue;
  }

  eligible.push({ id: user.id, email: user.email, previousTier: tier, createdAt: user.created_at });
}

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — cutoff: accounts created before ${cutoff.toISOString()}`);
console.log(`Grace period: ${GRACE_PERIOD_DAYS} days from now (expires ${graceExpiresAt.toISOString()})`);
console.log(`Eligible: ${eligible.length}`);
console.log(`Skipped (protected tier or already a Stripe customer): ${skipped.length}`);
for (const s of skipped) console.log(`  - ${s.email}: ${s.reason}`);

if (eligible.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

if (APPLY) {
  for (const u of eligible) {
    const { error } = await supabase
      .from("profiles")
      .update({ tier: "pro", pro_grace_expires_at: graceExpiresAt.toISOString() })
      .eq("id", u.id);
    if (error) {
      console.error(`  FAILED for ${u.email}:`, error);
    } else {
      console.log(`  granted: ${u.email} (was ${u.previousTier})`);
    }
  }
} else {
  console.log("Would grant Pro to:");
  for (const u of eligible) console.log(`  - ${u.email} (was ${u.previousTier}, signed up ${u.createdAt})`);
  console.log("\nRe-run with --apply to actually write these changes.");
}

// One-time email: no transactional email provider exists in this codebase
// yet (see AUDIT.md's open decision on this) — there is nowhere to
// actually SEND this from. Writing the exact recipient list and copy to
// files instead of sending is the honest version of "prepare the email"
// given that gap; send it manually (or once a provider is picked) rather
// than this script pretending to have delivered it.
mkdirSync("migration-output", { recursive: true });

const csvRows = ["email,previous_tier,pro_grace_expires_at"];
for (const u of eligible) csvRows.push(`${u.email},${u.previousTier},${graceExpiresAt.toISOString()}`);
writeFileSync("migration-output/legacy-pro-grace-recipients.csv", csvRows.join("\n") + "\n");

const graceDateReadable = graceExpiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const emailCopy = `Subject: You've got Pro on us for ${GRACE_PERIOD_DAYS} days

Hey — quick update on your Metis account.

We've just turned on real billing, and as a thank-you for being here before any of this
existed, we're giving your account full Pro access — unlimited quick profiles, Deep
Dive reports, Knowledge Graph, the works — free until ${graceDateReadable}.

After that, your account moves to our Free tier unless you pick a plan. If you'd like
to stay on Pro, we've got a founding-member rate for people who were here early:
$29/mo, locked in for as long as you keep the subscription. Just use the code at
checkout when you're ready — no rush before ${graceDateReadable}.

Questions, or something not adding up? Just reply to this email.

— Metis
`;
writeFileSync("migration-output/legacy-pro-grace-email.txt", emailCopy);

console.log("\nWrote migration-output/legacy-pro-grace-recipients.csv and legacy-pro-grace-email.txt");
console.log("(Not sent — no email provider is wired up yet. See CHECKLIST.md.)");
