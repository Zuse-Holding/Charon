import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

// Best-effort tier lookup for error context — mirrors /api/tier's pattern.
// Never throws; a failure here shouldn't block error reporting itself.
async function getTierForContext(): Promise<string> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "anonymous";

    const res = await fetch(`${AGENT_URL}/tier/${user.id}`, {
      headers: { "x-agent-secret": AGENT_SECRET },
    });
    if (!res.ok) return "unknown";

    const data = await res.json();
    return data.tier ?? "unknown";
  } catch {
    return "unknown";
  }
}

const SECTOR_QUERIES: Record<string, string> = {
  tech:       "tech startup funding acquisition product launch 2026",
  fintech:    "fintech payments startup funding round 2026",
  ai:         "artificial intelligence AI company launch product 2026",
  health:     "digital health biotech startup funding 2026",
  gaming:     "gaming company studio acquisition launch 2026",
  defense:    "defense aerospace startup contract funding 2026",
  climate:    "climate energy cleantech startup funding 2026",
  consumer:   "consumer brand retail startup funding acquisition 2026",
};

const SECTOR_LABELS: Record<string, string> = {
  tech:     "Tech & Software",
  fintech:  "Fintech & Payments",
  ai:       "AI & Machine Learning",
  health:   "Healthcare",
  gaming:   "Gaming",
  defense:  "Defense & Aerospace",
  climate:  "Climate & Energy",
  consumer: "Consumer & Retail",
};

// Domains to exclude from feed results
const NOISE_DOMAINS = ["youtube.com", "facebook.com", "instagram.com", "reddit.com", "twitter.com", "x.com"];

// Extract company names from a headline using simple heuristics
// Looks for capitalized proper nouns that aren't common words
const COMMON_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
  "but", "is", "are", "was", "were", "has", "have", "had", "will", "would",
  "new", "first", "last", "big", "top", "best", "how", "why", "what", "when",
  "where", "who", "which", "this", "that", "these", "those", "its", "their",
  "here", "there", "could", "should", "may", "might", "tech", "ai", "us",
  "report", "says", "raises", "launches", "announces", "acquires", "company",
  "startup", "billion", "million", "funding", "round", "series",
]);

function extractCompanyName(headline: string): string | null {
  // Pattern 1: "CompanyName raises/launches/acquires/announces..."
  const actionPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:raises|launches|acquires|announces|closes|files|lands|partners|expands|debuts|secures|unveils|releases|reports|cuts|hires|names|appoints)/;
  const m1 = headline.match(actionPattern);
  if (m1 && !COMMON_WORDS.has(m1[1].toLowerCase())) return m1[1];

  // Pattern 2: "$XM/XB funding" — company name before dollar amount
  const fundingPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:raises?|secures?|closes?)\s+\$[\d.]+[BMK]/i;
  const m2 = headline.match(fundingPattern);
  if (m2 && !COMMON_WORDS.has(m2[1].toLowerCase())) return m2[1];

  // Pattern 3: "CompanyName IPO/acquisition/merger"
  const corpPattern = /^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\s+(?:IPO|acquisition|merger|deal|funding|round|valuation)/i;
  const m3 = headline.match(corpPattern);
  if (m3 && !COMMON_WORDS.has(m3[1].toLowerCase())) return m3[1];

  return null;
}

// Best-effort date parse — Serper's per-result "date" field is often a
// relative string ("2 hours ago") rather than ISO, which Date() can't
// parse. Falling back to "now" rather than emitting an Invalid Date that
// would break the dashboard widget's relative-time display.
function safeIsoDate(input?: string): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function fetchSectorNews(sector: string, apiKey: string, num: number) {
  const res = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: SECTOR_QUERIES[sector], num }),
  });
  if (!res.ok) throw new Error(`Serper error: ${res.status}`);
  const data = await res.json();
  return (data.news ?? data.organic ?? []) as any[];
}

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector");
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Search not configured" }, { status: 503 });
  }

  // The Dashboard's compact "Intelligence Feed" widget calls this route
  // with no sector at all, expecting a flat digest — this used to
  // unconditionally 400 (root cause of tonight's intel-feed 400 reports),
  // since the route was built sector-first for the dedicated Intel Feed
  // page. Handle it as its own mode instead of rejecting it.
  if (!sector) {
    const digestSectors = ["tech", "fintech", "ai"];
    try {
      const results = await Promise.all(
        digestSectors.map((s) => fetchSectorNews(s, apiKey, 4).catch(() => []))
      );
      const items = results
        .flat()
        .filter((r) => !NOISE_DOMAINS.some((d) => (r.link ?? r.url ?? "").includes(d)))
        .slice(0, 6)
        .map((r, i) => ({
          id:           r.link ?? r.url ?? `digest-${i}`,
          title:        r.title,
          source:       r.source ?? "",
          url:          r.link ?? r.url ?? "#",
          published_at: safeIsoDate(r.date),
        }));
      return NextResponse.json(items);
    } catch (err) {
      console.error("[intel-feed] digest error:", err);
      // Empty array, not an error — the widget already has a graceful
      // "Feed is quiet" empty state for exactly this case.
      return NextResponse.json([]);
    }
  }

  if (!SECTOR_QUERIES[sector]) {
    console.warn(`[intel-feed] Rejected request — unknown sector: ${JSON.stringify(sector)}. Full query: ${req.nextUrl.search}`);
    return NextResponse.json({ error: "Invalid sector", received: sector }, { status: 400 });
  }

  try {
    const raw = await fetchSectorNews(sector, apiKey, 8);
    const items = raw
      .filter((r: any) => !NOISE_DOMAINS.some(d => (r.link ?? r.url ?? "").includes(d)))
      .slice(0, 5)
      .map((r: any) => ({
        headline: r.title,
        summary:  r.snippet ?? "",
        url:      r.link ?? r.url ?? "#",
        source:   r.source ?? "",
        company:  extractCompanyName(r.title),
      }));

    return NextResponse.json({
      sector,
      label: SECTOR_LABELS[sector],
      items,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const tier = await getTierForContext();
    Sentry.captureException(err, {
      tags: { route: "intel-feed" },
      extra: {
        sector,
        query: req.nextUrl.search,
        tier,
      },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
