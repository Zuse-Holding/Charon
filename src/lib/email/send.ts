/**
 * Task 4.2 — transactional email via Resend. No email provider existed
 * anywhere in this codebase before this task (confirmed in AUDIT.md and
 * again while writing grant-legacy-pro-grace.mjs, task B). Resend is a
 * default choice, not a researched one — low-friction to set up, easy to
 * swap later since every call in this codebase goes through sendEmail()
 * here rather than touching the Resend SDK directly. Same posture as
 * Stripe was given before real keys existed: fully wired, no-ops without
 * a key rather than blocking the feature it supports.
 */
import { Resend } from "resend";

let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  const key = process.env.RESEND_API_KEY;
  client = key ? new Resend(key) : null;
  return client;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ sent: boolean }> {
  const resend = getClient();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — not sending "${opts.subject}" to ${opts.to}`);
    return { sent: false };
  }
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Metis <onboarding@resend.dev>",
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      replyTo: opts.replyTo,
    });
    if (error) {
      console.error(`[email] send failed for "${opts.subject}" to ${opts.to}:`, error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[email] send threw for "${opts.subject}" to ${opts.to}:`, err);
    return { sent: false };
  }
}
