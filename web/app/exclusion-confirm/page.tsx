import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAgentSecret } from "../../lib/agent-secret";
import { isEnabled } from "../../lib/flags";
import styles from "./page.module.css";

/**
 * Self-exclusion confirmation (Feature 6). Opened from the emailed link,
 * possibly without a session, so it lives outside the signed-in area. It
 * asks for a click rather than confirming on load: mail scanners open
 * links, and a scanner shouldn't be able to confirm on someone's behalf.
 */

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  let ok = false;
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl && token) {
    try {
      const res = await fetch(`${agentUrl}/exclusions/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
  }
  redirect(`/exclusion-confirm?result=${ok ? "done" : "failed"}`);
}

export default async function ExclusionConfirm({ searchParams }: { searchParams: Promise<{ token?: string; result?: string }> }) {
  if (!isEnabled("self_exclusion")) notFound();
  const { token, result } = await searchParams;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.label}>Self-exclusion</div>
        {result === "done" ? (
          <>
            <h1 className={styles.title}>You&apos;re excluded.</h1>
            <p className={styles.text}>Metis won&apos;t follow this identifier when it expands research, for any user. You can remove it any time.</p>
            <Link href="/settings/self-exclusion" className={styles.link}>See your list</Link>
          </>
        ) : result === "failed" ? (
          <>
            <h1 className={styles.title}>That link didn&apos;t work.</h1>
            <p className={styles.text}>It may have expired (links last 24 hours) or already been used. Add the entry again from your account to get a new one.</p>
            <Link href="/settings/self-exclusion" className={styles.link}>Go to your list</Link>
          </>
        ) : token ? (
          <form action={confirm}>
            <h1 className={styles.title}>Confirm your exclusion</h1>
            <p className={styles.text}>Once confirmed, Metis won&apos;t follow this identifier when it expands research, for any user.</p>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={styles.button}>Confirm exclusion</button>
          </form>
        ) : (
          <>
            <h1 className={styles.title}>Nothing to confirm.</h1>
            <p className={styles.text}>Open the link from your confirmation email.</p>
          </>
        )}
      </div>
    </main>
  );
}
