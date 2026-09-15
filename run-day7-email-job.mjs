// Task 4.2 — day-7 "what did Metis get wrong?" email. Meant to run daily
// via cron (Railway Cron service, same as run-daily-creator-jobs.mjs) —
// each run finds accounts that turned exactly 7+ days old since the last
// run and haven't been sent this email yet, sends it, and marks
// profiles.day7_email_sent_at so a re-run (or tomorrow's run) doesn't
// send it again. That column is the entire de-dupe mechanism; there's no
// separate "already sent" table because one boolean-ish timestamp per
// account is all this needs.
//
// Windowed on created_at >= 7 days ago (not "exactly 7 days ago") so a
// day the job doesn't run (a deploy, a crash) doesn't silently skip
// anyone — the day7_email_sent_at IS NULL filter is what prevents
// duplicate sends, not the date window.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { day7Email } from "./src/lib/email/copy.js";
import { sendEmail } from "./src/lib/email/send.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.log("[day7-email-job] RESEND_API_KEY not set — nothing to do.");
    return true;
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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

  const due = allUsers.filter((u) => {
    if (new Date(u.created_at) > cutoff) return false; // not 7 days old yet
    const profile = profileById.get(u.id);
    return !profile?.day7_email_sent_at;
  });

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

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error("[day7-email-job] Fatal error:", err);
    process.exit(1);
  });
