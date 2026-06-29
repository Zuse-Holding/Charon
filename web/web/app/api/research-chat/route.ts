import { NextRequest, NextResponse } from "next/server";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const SERPER_API = "https://google.serper.dev/search";

const SYSTEM = `You are the Charon Research Module — a sharp, operator-grade market and business intelligence agent. You are part of Charon, built by Zuse Holdings and powered by Selene.

You specialize in:
- Market sizing (TAM/SAM/SOM analysis)
- Competitive landscape mapping
- Industry trend signals
- Business model evaluation
- Revenue model breakdowns
- Go-to-market strategy analysis
- Startup viability and opportunity scoring

Response style:
- Lead with the key finding or headline number
- Be structured, signal-dense — no filler
- Use markdown: **bold**, ## headers, - bullet points
- Close with 1–2 sharp actionable insights
- Operator tone: direct, precise, genuinely useful`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SerperResult {
  title: string;
  snippet: string;
  link: string;
}

async function searchSerper(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(SERPER_API, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 6 }),
    });
    const data = await res.json();
    const organic: SerperResult[] = data.organic ?? [];
    return organic
      .slice(0, 5)
      .map((r) => `[${r.title}]\n${r.snippet}\nSource: ${r.link}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { message, history = [] } = await req.json() as {
    message: string;
    history: Message[];
  };

  const groqKey = process.env.GROQ_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (!groqKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not set" }, { status: 500 });
  }

  // Run Serper search if key available
  let searchContext = "";
  if (serperKey) {
    searchContext = await searchSerper(message, serperKey);
  }

  const userContent = searchContext
    ? `Research query: ${message}\n\n--- WEB SEARCH RESULTS ---\n${searchContext}\n--- END RESULTS ---\n\nSynthesize the above into an operator-grade research response.`
    : message;

  const messages = [
    { role: "system", content: SYSTEM },
    // Last 6 turns for context window efficiency
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  try {
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        messages,
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    const data = await groqRes.json();
    const reply =
      data.choices?.[0]?.message?.content ?? "// No response from LLM.";
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[research-chat]", err);
    return NextResponse.json(
      { reply: "// Signal lost. Check server logs." },
      { status: 500 }
    );
  }
}
