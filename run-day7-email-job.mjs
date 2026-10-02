// Task 4.2 — day-7 "what did Metis get wrong?" email. Meant to run daily
// via cron (Railway Cron service, same as run-daily-creator-jobs.mjs) —
// each run finds accounts that turned exactly 7+ days old since the last
// run and haven't been sent this email yet, sends it, and marks
// profiles.day7_email_sent_at so a re-run (or tomorrow's run) doesn't
// send it again. That column is the entire de-dupe mechanism; there's no
// separate "already sent" table because one boolean-ish timestamp per
// account is all this needs.
//
// Windowed on accounts 7 to 14 days old (not "exactly 7 days ago") so a
// day the job doesn't run (a deploy, a crash) doesn't silently skip
// anyone — the day7_email_sent_at IS NULL filter is what prevents
// duplicate sends, not the date window. The 14-day upper bound matters
// on the first run: without it, every account older than a week (all
// legacy users) would get a "you signed up about a week ago" email.
//
// Runs daily as a stage of run-daily-creator-jobs.mjs (the one Railway
// Cron service), or on its own: npm run day7-email-job.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { day7Email } from "./src/lib/email/copy.js";
import { sendEmail } from "./src/lib/email/send.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAY7_WINDOW_DAYS = { min: 7, max: 14 };

/** Accounts due the day-7 email: 7–14 days old, never sent it. */
export function dueForDay7(users, profileById, now = Date.now()) {
  const newest = now - DAY7_WINDOW_DAYS.min * DAY_MS;
  const oldest = now - DAY7_WINDOW_DAYS.max * DAY_MS;
  return users.filter((u) => {
    const created = new Date(u.created_at).getTime();
    if (created > newest || created < oldest) return false;
    return !profileById.get(u.id)?.day7_email_sent_at;
  });
}

export async function runDay7EmailJob() {
  if (!process.env.RESEND_API_KEY) {
    console.log("[day7-email-job] RESEND_API_KEY not set — nothing to do.");
    return true;
  }

  // Same pagination pattern as grant-legacy-pro-grace.mjs — auth.users is
  // the only place account age (created_at) and email live together.
  let allUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error("[day7-email-job] listUsers failed:", error);
      return false;
    }
    allUsers = allUsers.concat(data.users);
    if (data.users.length < 1000) break;
    page++;
  }

  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, display_name, day7_email_sent_at");
  if (profilesErr) {
    console.error("[day7-email-job] profiles fetch failed:", profilesErr);
    return false;
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const due = dueForDay7(allUsers, profileById);

  console.log(`[day7-email-job] ${due.length} account(s) due.`);

  let sent = 0;
  let failed = 0;
  for (const user of due) {
    if (!user.email) continue;
    const firstName = profileById.get(user.id)?.display_name?.split(" ")[0] ?? "";
    const { subject, text, replyTo } = day7Email(firstName);
    const result = await sendEmail({ to: user.email, subject, text, replyTo });
    if (result.sent) {
      const { error } = await supabase
        .from("profiles")
        .update({ day7_email_sent_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        console.error(`[day7-email-job] sent to ${user.email} but failed to mark sent:`, error);
        failed++;
      } else {
        sent++;
      }
    } else {
      failed++;
    }
  }

  console.log(`[day7-email-job] Done — ${sent} sent, ${failed} failed.`);
  return failed === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDay7EmailJob()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error("[day7-email-job] Fatal error:", err);
      process.exit(1);
    });
}
