/**
 * Task 4.2 — the one place to edit transactional email copy. Plain text,
 * signed by the team rather than an individual.
 */
export const SENDER_NAME = "The Metis team";
export const SUPPORT_EMAIL = "support@metisanalytic.com";
const APP_URL = process.env.FRONTEND_URL ?? "https://metisanalytic.com";

export interface EmailContent {
  subject: string;
  text: string;
  replyTo?: string;
}

export function welcomeEmail(firstName: string): EmailContent {
  const name = firstName?.trim() || "there";
  return {
    subject: "Welcome to Metis",
    text: `Hey ${name},

Thanks for signing up for Metis. You can start researching right away —
type a company, person, or product name into the search box and we'll put
together a full report for you: ${APP_URL}/app

If anything in a report looks off, there's a "Something wrong in this
report?" link at the bottom of every one — we read every submission.

Questions? Just reply to this email.

— ${SENDER_NAME}
`,
  };
}

export function day7Email(firstName: string): EmailContent {
  const name = firstName?.trim() || "there";
  return {
    subject: "What did Metis get wrong?",
    text: `Hey ${name},

You signed up for Metis about a week ago, and we wanted to ask directly:
what did it get wrong?

Every report is only as good as the sources it can find, and the fastest
way we improve is hearing about the specific thing that was outdated,
missing, or just off. Hit reply and tell us — we read every one of these.

— ${SENDER_NAME}
`,
    replyTo: SUPPORT_EMAIL,
  };
}

export function capReachedEmail(firstName: string, capLabel: string): EmailContent {
  const name = firstName?.trim() || "there";
  return {
    subject: `You've hit your ${capLabel}`,
    text: `Hey ${name},

You just ran into your ${capLabel} on Metis. Wanted to flag what Pro gets
you if you want to keep going: unlimited quick profiles, Deep Dive reports,
Knowledge Graph access, and priority research queueing —
${APP_URL}/pricing

Since you found us early, we've got a founding-member rate: Pro at
$29/mo, locked in for as long as you keep the subscription. Use the code
at checkout.

Questions, or something not adding up? Just reply to this email.

— ${SENDER_NAME}
`,
  };
}
