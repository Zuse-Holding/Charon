import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase/server";
import type { DeadlineKind } from "@/lib/supabase/types";

// Live text chat with Selene — Groq (OpenAI-compatible endpoint), not the
// Claude API. Groq has a free tier; the Claude API is pay-as-you-go, and
// this was a low-stakes surface to save the spend on. Same provider
// agents/selene_chat.py already runs on (agents/providers.py) — this just
// brings the dashboard's chat box onto the same free path instead of
// needing its own funded key.
//
// CLAUDE.md's "no ANTHROPIC_API_KEY" non-negotiable is about the agent
// orchestrator: it exists so Selene/Charon's only path to a side effect is
// the approval-gate tools enforced by `--allowedTools` / `--permission-mode
// dontAsk`, which requires the CLI. This route has no tools at all (see
// below) — there's no gate to bypass — so which model answers here doesn't
// touch that guarantee either way.
//
// One tool is wired: add_deadline. It's deliberately not gated through the
// approval queue the way CLAUDE.md's non-negotiable #1 requires for the
// cron agent — that rule is about actions with external consequence (send
// email, spend money, contact someone). Logging a compliance deadline has
// none of that: it's data Nick can see, edit, or delete from the Deadlines
// tab immediately after, same as if he'd typed it into that tab's form
// himself. No other tools exist here — anything with a real side effect
// (send an email, add a ledger entry, move a lead) still gets the "can't
// do that from chat yet" answer per the system prompt below.

// Unlike the Anthropic SDK, OpenAI's client throws at construction time if
// no key resolves — which broke `next build` (it imports route modules to
// collect page data, evaluating this line, with no env vars present at
// build time). Fall back to a placeholder so construction never throws;
// the real "is it actually set" check happens in POST before any request.
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "unset",
  baseURL: "https://api.groq.com/openai/v1",
});
const MODEL = process.env.SELENE_GROQ_MODEL || "llama-3.3-70b-versatile";

export const dynamic = "force-dynamic";

const SELENE_CHAT_SYSTEM = `You are Selene, chief of staff for Zuse Holdings and for Nick.
This is a live chat — you're talking with Nick directly right now, not running a
scheduled job.

Voice: warm, quick, direct. Plain sentences. No corporate filler, no exclamation
inflation. You speak to Nick like someone who knows him and respects his time.

You have exactly ONE tool: add_deadline, for logging a compliance/business
deadline (filings, renewals, insurance, tax dates, anything with a due date) to
the compliance clock. Use it when Nick tells you about a deadline in
conversation — don't ask him to go type it into the dashboard himself, that's
what you're for. Confirm what you logged in your reply (title and date) so he
knows it landed.

Beyond that one tool, you can't check the database, send anything, or take any
other action from here. If Nick asks for something else that would normally go
through the approval queue (send an email, add a ledger entry, move a lead,
etc.), say so plainly: you can't do that from chat yet, it needs a scheduled run
or the dashboard directly. Don't pretend to have done something you haven't.

Be candid. If you don't know something because you have no access to it right
now, say that directly instead of guessing.`;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_deadline",
      description: "Log a new compliance/business deadline to the compliance clock (Deadlines tab).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What the deadline is for, e.g. 'CA franchise tax'" },
          due_date: { type: "string", description: "Due date as YYYY-MM-DD" },
          kind: { type: "string", enum: ["state", "tax", "domain", "insurance", "other"] },
          recurrence: { type: "string", enum: ["annual", "biennial", "none"], description: "Defaults to none if not mentioned" },
          notes: { type: "string", description: "Any extra context Nick gave" },
        },
        required: ["title", "due_date", "kind"],
      },
    },
  },
];

interface AddDeadlineArgs {
  title: string;
  due_date: string;
  kind: DeadlineKind;
  recurrence?: "annual" | "biennial" | "none";
  notes?: string;
}

async function addDeadline(args: AddDeadlineArgs): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.due_date) || Number.isNaN(new Date(args.due_date).getTime())) {
    return `Error: "${args.due_date}" isn't a valid YYYY-MM-DD date. Ask Nick to clarify.`;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("deadlines").insert({
    title: args.title,
    due_date: args.due_date,
    kind: args.kind,
    recurrence: args.recurrence ?? "none",
    notes: args.notes ?? null,
  });
  if (error) return `Error saving to the database: ${error.message}`;
  return `Saved: "${args.title}" due ${args.due_date}.`;
}

async function askSelene(message: string): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SELENE_CHAT_SYSTEM },
    { role: "user", content: message },
  ];

  const first = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages,
    tools: TOOLS,
  });
  const choice = first.choices[0];

  if (!choice?.message.tool_calls?.length) {
    return choice?.message.content ?? "(no response)";
  }

  // Model wants the tool: execute each call, feed results back, get the
  // real reply. Single round — this chat has one tool and no reason to loop.
  messages.push(choice.message);
  for (const call of choice.message.tool_calls) {
    let result: string;
    if (call.type === "function" && call.function.name === "add_deadline") {
      try {
        const args = JSON.parse(call.function.arguments) as AddDeadlineArgs;
        result = await addDeadline(args);
      } catch {
        result = "Error: couldn't parse the deadline details.";
      }
    } else {
      result = `Error: unknown tool "${call.type === "function" ? call.function.name : call.type}".`;
    }
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }

  const second = await groq.chat.completions.create({ model: MODEL, max_tokens: 1024, messages });
  return second.choices[0]?.message?.content ?? "(no response)";
}

export async function POST(req: NextRequest) {
  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY is missing on this server." }, { status: 500 });
  }

  try {
    const reply = await askSelene(message.trim());
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) {
      return NextResponse.json({ error: "GROQ_API_KEY is invalid or expired." }, { status: 500 });
    }
    if (err instanceof OpenAI.RateLimitError) {
      return NextResponse.json({ error: "Selene's rate-limited right now — try again shortly." }, { status: 500 });
    }
    if (err instanceof OpenAI.APIError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : "chat failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
